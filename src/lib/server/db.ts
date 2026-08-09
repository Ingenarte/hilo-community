import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join as pathJoin } from 'node:path';
import { config } from './env';
// `?raw` inlines the SQL into the bundle, so production builds don't need
// the file to be present at the same relative path as in dev.
import schema from './schema.sql?raw';

const dbPath = resolve(config.databasePath);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(schema);

// In-place migrations: SQLite has no `ADD COLUMN IF NOT EXISTS`, so we
// inspect the table and add new columns on the fly when the schema has
// evolved between releases.
function ensureColumn(table: string, column: string, ddl: string): void {
	const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	if (!rows.some((r) => r.name === column)) {
		db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
	}
}
ensureColumn('users', 'theme', `theme TEXT NOT NULL DEFAULT 'dark'`);
ensureColumn('users', 'accent', `accent TEXT NOT NULL DEFAULT 'violet'`);
ensureColumn('users', 'email_schedule', `email_schedule TEXT NOT NULL DEFAULT 'immediate'`);
ensureColumn('messages', 'edited_at', `edited_at INTEGER`);
ensureColumn('messages', 'deleted_at', `deleted_at INTEGER`);
ensureColumn('ticket_followers', 'role', `role TEXT NOT NULL DEFAULT 'member'`);
ensureColumn('users', 'disabled_at', `disabled_at INTEGER`);
ensureColumn('tickets', 'priority', `priority TEXT NOT NULL DEFAULT 'normal'`);
// SQLite ALTER TABLE ADD COLUMN doesn't accept REFERENCES — new instances
// get the FK from schema.sql, upgrades keep referential integrity in code.
ensureColumn('tickets', 'assigned_to', `assigned_to INTEGER`);
ensureColumn('tickets', 'archived_at', `archived_at INTEGER`);
ensureColumn('messages', 'internal', `internal INTEGER NOT NULL DEFAULT 0`);

// Sprint groups (after sprint-26may): optional group tag on a ticket.
// SQLite ALTER TABLE cannot add a column with REFERENCES; FK is enforced
// in application code (the group must exist + belong to one of the
// ticket's projects). Set NULL on group delete handled by the API.
ensureColumn('tickets', 'group_id', `group_id INTEGER`);

// New in sprint-26may: per-user passwords + project status + creator track
ensureColumn('users', 'password_hash', `password_hash TEXT`);
ensureColumn('projects', 'status',
	// NOTE: CHECK constraints on ALTER TABLE ADD COLUMN are not enforced in
	// SQLite for existing rows; validation is done in application code.
	`status TEXT NOT NULL DEFAULT 'active'`);
ensureColumn('projects', 'created_by_user_id', `created_by_user_id INTEGER`);
// SQLite ALTER TABLE ADD COLUMN does not support REFERENCES; new databases
// pick up the FK from schema.sql; upgrades enforce referential integrity in code.

// Sprint-29may: reply-to-message threading. FK enforced in application code.
ensureColumn('messages', 'replied_to_message_id', `replied_to_message_id INTEGER`);
// Index for efficient lookup of threads (which messages reply to a given message).
db.exec(
	'CREATE INDEX IF NOT EXISTS idx_messages_replied_to ON messages(replied_to_message_id)'
);

// Sprint-31may: per-session device fingerprint so /admin/users can show
// which devices a user actually opens the app on. Populated at session
// creation only — no per-request write hot-path.
ensureColumn('sessions', 'user_agent', `user_agent TEXT`);
ensureColumn('sessions', 'device_class', `device_class TEXT`); // 'mobile'|'tablet'|'desktop'
ensureColumn('sessions', 'display_mode', `display_mode TEXT`); // 'browser'|'pwa'
ensureColumn('sessions', 'os_hint', `os_hint TEXT`); // 'iOS'|'Android'|'macOS'|'Windows'|'Linux'|'other'
db.exec(
	'CREATE INDEX IF NOT EXISTS idx_sessions_user_lastseen ON sessions(user_id, last_seen)'
);

// Sprint-32jun: self-hosted audio transcription. Adds four columns to the
// attachments table so transcripts are stored alongside the audio row.
// New installs get them from schema.sql; existing prod gets them here.
ensureColumn('attachments', 'transcript_status', `transcript_status TEXT`);
ensureColumn('attachments', 'transcript_text', `transcript_text TEXT`);
ensureColumn('attachments', 'transcript_lang', `transcript_lang TEXT`);
ensureColumn('attachments', 'transcript_updated_at', `transcript_updated_at INTEGER`);
db.exec(
	'CREATE INDEX IF NOT EXISTS idx_attachments_transcript_status ON attachments(transcript_status)'
);

// Sprint-35jun: first-login install-help modal tracking.
// NULL = never seen; non-null = unix epoch of first dismissal.
ensureColumn('users', 'seen_install_help_at', `seen_install_help_at INTEGER`);

// Sprint-40jun: 'pending' was a dead-end project status with no approval UI.
// Promote any existing pending projects to 'active' so the admin toggle
// (active <-> archived) covers every row. Idempotent — runs once then no-ops.
db.prepare(`UPDATE projects SET status = 'active' WHERE status = 'pending'`).run();

// Sprint-38jun: per-user per-kind email throttle table.
// `CREATE TABLE IF NOT EXISTS` in schema.sql handles new installs.
// This exec ensures existing prod DBs pick it up on next boot.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_throttle (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    last_sent_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind)
  );
`);

// Sprint-33jun: chunked tus.io upload sessions.
// `CREATE TABLE IF NOT EXISTS` in schema.sql handles new installs.
// For existing prod DBs the table is created here so the server starts
// cleanly even if the SQL block above was a no-op (table already exists).
// Note: this CREATE uses the OLD constraint so that new installs that have
// not yet been migrated start cleanly. The migration below upgrades the
// CHECK constraint to include 'assembling' and 'attached'.
db.exec(`
  CREATE TABLE IF NOT EXISTS upload_sessions (
    id              TEXT PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    total_bytes     INTEGER NOT NULL,
    received_bytes  INTEGER NOT NULL DEFAULT 0,
    partial_path    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','complete','aborted','expired')),
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_upload_sessions_user
    ON upload_sessions(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires
    ON upload_sessions(expires_at) WHERE status = 'open';
`);

// Sprint-34jun: add 'assembling' and 'attached' statuses to upload_sessions.
// SQLite cannot ALTER TABLE to change a CHECK constraint, so we detect the
// old constraint via sqlite_master and rebuild the table if needed.
// This is a one-time migration; subsequent boots are no-ops.
{
	const ddl = (
		db
			.prepare(
				`SELECT sql FROM sqlite_master WHERE type='table' AND name='upload_sessions'`
			)
			.get() as { sql: string } | undefined
	)?.sql ?? '';
	if (!ddl.includes("'assembling'") || !ddl.includes("'attached'")) {
		db.exec(`
      BEGIN;
      CREATE TABLE upload_sessions_new (
        id              TEXT PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        filename        TEXT NOT NULL,
        mime_type       TEXT NOT NULL,
        total_bytes     INTEGER NOT NULL,
        received_bytes  INTEGER NOT NULL DEFAULT 0,
        partial_path    TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','assembling','complete','attached','aborted','expired')),
        created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at      INTEGER NOT NULL
      );
      INSERT INTO upload_sessions_new SELECT * FROM upload_sessions;
      DROP TABLE upload_sessions;
      ALTER TABLE upload_sessions_new RENAME TO upload_sessions;
      CREATE INDEX IF NOT EXISTS idx_upload_sessions_user
        ON upload_sessions(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires
        ON upload_sessions(expires_at) WHERE status = 'open';
      COMMIT;
    `);
	}
}

// Sprint-34jun B4: recover 'assembling' rows left by a crash mid-rename.
// If the final file exists, complete the transition; otherwise mark aborted.
{
	const assemblingRows = db
		.prepare(
			`SELECT id, partial_path FROM upload_sessions WHERE status = 'assembling'`
		)
		.all() as Array<{ id: string; partial_path: string }>;
	for (const row of assemblingRows) {
		// After a successful rename, partial_path holds the storedName (not a full path).
		// The storedName does not contain a directory separator.
		const isStoredName = !row.partial_path.includes('/') && !row.partial_path.includes('\\');
		let finalExists = false;
		if (isStoredName) {
			const uploadDir = resolve(config.uploadDir);
			finalExists = existsSync(pathJoin(uploadDir, row.partial_path));
		}
		// If not isStoredName: partial_path is still the absolute .part path — rename
		// did not happen. File may exist in a corrupted state; mark aborted.
		if (finalExists) {
			db.prepare(
				`UPDATE upload_sessions SET status = 'complete' WHERE id = ?`
			).run(row.id);
		} else {
			db.prepare(
				`UPDATE upload_sessions SET status = 'aborted' WHERE id = ?`
			).run(row.id);
		}
	}
}

// One-shot backfill: feed the FTS index from existing message bodies. Idempotent
// because we wipe the index first.
const ftsRows = db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number };
const msgRows = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
if (ftsRows.n < msgRows.n) {
	db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild');`);
}

// Seed the default project (AETHER) if no projects exist.
const projectCount = db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number };
if (projectCount.n === 0) {
	db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run('AETHER', 'aether');
}

// Ensure the admin user exists (auto-provisioned from ADMIN_EMAIL).
const existing = db
	.prepare('SELECT id FROM users WHERE email = ?')
	.get(config.adminEmail) as { id: number } | undefined;
if (!existing) {
	db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(config.adminEmail, 'admin');
} else {
	db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', existing.id);
}

// Sprint-26may bootstrap: if the admin has no password_hash yet, generate
// one and send it by email. Idempotent — only runs once post-migration.
const adminRow = db
	.prepare('SELECT id, password_hash FROM users WHERE email = ?')
	.get(config.adminEmail) as { id: number; password_hash: string | null } | undefined;

if (adminRow && !adminRow.password_hash) {
	// Lazy import to avoid loading nodemailer on every cold module load.
	// The `.catch` is required: an unhandled rejection here (SMTP down,
	// network error) silently disappears and the admin would never get
	// their password email, with no signal in the logs.
	import('./bootstrap-admin')
		.then((mod) => mod.bootstrapAdminPassword(adminRow.id, config.adminEmail))
		.catch((err) => console.error('[bootstrap] admin password setup failed:', err));
}

// Same treatment for any pre-sprint user accounts that never had a per-user
// password. Independent of the admin path so each can run on its own.
const legacyUsers = db
	.prepare(
		`SELECT COUNT(*) AS n FROM users
		 WHERE password_hash IS NULL AND disabled_at IS NULL AND role = 'user'`
	)
	.get() as { n: number };
if (legacyUsers.n > 0) {
	import('./bootstrap-admin')
		.then((mod) => mod.bootstrapLegacyUsers())
		.catch((err) => console.error('[bootstrap] legacy user setup failed:', err));
}

export type DBUser = {
	id: number;
	email: string;
	role: 'user' | 'admin';
	theme: 'dark' | 'light';
	accent: 'violet' | 'cyan' | 'emerald' | 'amber';
	email_schedule: string;
	created_at: number;
	last_seen: number | null;
};

export type DBOutboxItem = {
	id: number;
	user_id: number | null;
	to_email: string;
	subject: string;
	text_body: string;
	html_body: string;
	attachments_json: string;
	send_after: number;
	attempts: number;
	sent_at: number | null;
	error: string | null;
	created_at: number;
};

export type DBProject = {
	id: number;
	name: string;
	slug: string;
	created_at: number;
};

export type TicketStatus = 'open' | 'pending' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

export type DBTicket = {
	id: number;
	user_id: number;
	title: string;
	status: TicketStatus;
	priority: TicketPriority;
	assigned_to: number | null;
	group_id: number | null;
	archived_at: number | null;
	created_at: number;
	updated_at: number;
};

export type DBTemplate = {
	id: number;
	title: string;
	body: string;
	created_by: number | null;
	created_at: number;
};

export type DBWebhook = {
	id: number;
	name: string;
	url: string;
	kind: 'slack' | 'discord' | 'generic';
	events: string;
	enabled: 0 | 1;
	created_at: number;
};

export type DBReaction = {
	message_id: number;
	user_id: number;
	emoji: string;
	created_at: number;
};

export type DBMessage = {
	id: number;
	ticket_id: number;
	sender_id: number;
	sender_role: 'user' | 'admin';
	body: string;
	internal: 0 | 1;
	edited_at: number | null;
	deleted_at: number | null;
	created_at: number;
	replied_to_message_id: number | null;
};

export type TranscriptStatus = 'pending' | 'ready' | 'failed';

export type DBAttachment = {
	id: number;
	message_id: number;
	filename: string;
	stored_name: string;
	mime_type: string;
	size_bytes: number;
	created_at: number;
	// Transcription fields — null until a user requests transcription.
	transcript_status: TranscriptStatus | null;
	transcript_text: string | null;
	transcript_lang: string | null;
	transcript_updated_at: number | null;
};

export type UploadSessionStatus = 'open' | 'assembling' | 'complete' | 'attached' | 'aborted' | 'expired';

export type DBUploadSession = {
	id: string;
	user_id: number;
	ticket_id: number;
	filename: string;
	mime_type: string;
	total_bytes: number;
	received_bytes: number;
	partial_path: string;
	status: UploadSessionStatus;
	created_at: number;
	expires_at: number;
};

export type DBTicketTask = {
	id: number;
	ticket_id: number;
	assignee_user_id: number;
	created_by_user_id: number;
	title: string;
	description: string;
	completed_at: number | null;
	completed_by_user_id: number | null;
	created_at: number;
};
