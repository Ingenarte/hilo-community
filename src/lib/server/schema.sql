-- Hilo schema
-- SQLite ≥ 3.38 (strict tables)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
	id                   INTEGER PRIMARY KEY AUTOINCREMENT,
	email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
	role                 TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
	theme                TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
	accent               TEXT NOT NULL DEFAULT 'violet',
	-- Notification delivery window. 'immediate' sends right away; the
	-- regional keys (e.g. 'europe-central') queue until 9-18 Mon-Fri in
	-- that timezone; or an IANA tz like 'America/Argentina/Buenos_Aires'.
	email_schedule       TEXT NOT NULL DEFAULT 'immediate',
	created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
	last_seen            INTEGER,
	-- Unix epoch when the user first dismissed the install-help modal.
	-- NULL means they have never seen or dismissed it.
	seen_install_help_at INTEGER
);

-- ─── Outbound email queue ──────────────────────────────────────────────────
-- Snapshots the rendered email at enqueue time so changing the recipient's
-- theme later doesn't mutate already-queued messages.
CREATE TABLE IF NOT EXISTS email_outbox (
	id                INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
	to_email          TEXT NOT NULL,
	subject           TEXT NOT NULL,
	text_body         TEXT NOT NULL,
	html_body         TEXT NOT NULL,
	attachments_json  TEXT NOT NULL DEFAULT '[]',
	send_after        INTEGER NOT NULL,
	attempts          INTEGER NOT NULL DEFAULT 0,
	sent_at           INTEGER,
	error             TEXT,
	created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending
	ON email_outbox(send_after) WHERE sent_at IS NULL;

-- ─── Ticket followers (multi-CC) ──────────────────────────────────────────
-- Extra email addresses that receive notifications for a given ticket.
-- Not Hilo users — just email strings.
CREATE TABLE IF NOT EXISTS ticket_followers (
	ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
	email       TEXT NOT NULL COLLATE NOCASE,
	-- Participant role. `viewer` reads-only, `member` reads + writes,
	-- `mod` adds the ability to invite / remove other participants.
	-- Plain CC (no Hilo account) defaults to `member` since they can't
	-- actually log in either way.
	role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('viewer','member','mod')),
	added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (ticket_id, email)
);

-- ─── Audit log ─────────────────────────────────────────────────────────────
-- Single append-only feed of "interesting" actions. Used by /admin/audit
-- and by anyone who later wants to plug into compliance flows.
CREATE TABLE IF NOT EXISTS audit_log (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
	actor_email TEXT,
	action      TEXT NOT NULL,   -- e.g. 'ticket.created', 'project.deleted'
	target      TEXT,            -- e.g. 'ticket:42', 'project:7'
	detail_json TEXT,             -- arbitrary JSON for action-specific metadata
	created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);

-- ─── Web Push subscriptions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	endpoint    TEXT NOT NULL UNIQUE,
	p256dh      TEXT NOT NULL,
	auth        TEXT NOT NULL,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- ─── IMAP poller state ────────────────────────────────────────────────────
-- Single-row table holding the highest UID already ingested per mailbox.
CREATE TABLE IF NOT EXISTS imap_state (
	mailbox   TEXT PRIMARY KEY,
	last_uid  INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS projects (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
	slug        TEXT NOT NULL UNIQUE COLLATE NOCASE,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tickets (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title         TEXT NOT NULL,
	status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
	priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
	assigned_to   INTEGER REFERENCES users(id) ON DELETE SET NULL,
	archived_at   INTEGER,
	created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
	updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_archived ON tickets(archived_at);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_updated ON tickets(updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_projects (
	ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
	project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	PRIMARY KEY (ticket_id, project_id)
);

CREATE TABLE IF NOT EXISTS messages (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	ticket_id     INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
	sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	sender_role   TEXT NOT NULL CHECK (sender_role IN ('user', 'admin')),
	body          TEXT NOT NULL DEFAULT '',
	internal      INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
	edited_at     INTEGER,
	deleted_at    INTEGER,
	created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS reactions (
	message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	emoji       TEXT NOT NULL,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS templates (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	title       TEXT NOT NULL,
	body        TEXT NOT NULL,
	created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS webhooks (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	name        TEXT NOT NULL,
	url         TEXT NOT NULL,
	-- 'slack' (Slack-compatible payload), 'discord', or 'generic' (raw JSON).
	kind        TEXT NOT NULL DEFAULT 'generic' CHECK (kind IN ('slack', 'discord', 'generic')),
	-- comma-separated list of events to fire on, e.g. 'ticket.new,ticket.urgent'.
	events      TEXT NOT NULL DEFAULT 'ticket.new',
	enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Full-text index over message bodies + ticket titles. Repopulated lazily
-- via triggers below; the cleanup script rebuilds it monthly.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
	body, ticket_id UNINDEXED, content='messages', content_rowid='id',
	tokenize="unicode61 remove_diacritics 2"
);
CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
	INSERT INTO messages_fts(rowid, body, ticket_id) VALUES (new.id, new.body, new.ticket_id);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, body, ticket_id) VALUES('delete', old.id, old.body, old.ticket_id);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, body, ticket_id) VALUES('delete', old.id, old.body, old.ticket_id);
	INSERT INTO messages_fts(rowid, body, ticket_id) VALUES (new.id, new.body, new.ticket_id);
END;

CREATE TABLE IF NOT EXISTS attachments (
	id                   INTEGER PRIMARY KEY AUTOINCREMENT,
	message_id           INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
	filename             TEXT NOT NULL,
	stored_name          TEXT NOT NULL,
	mime_type            TEXT NOT NULL,
	size_bytes           INTEGER NOT NULL,
	created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
	-- Transcription fields (audio attachments only; NULL for images / docs).
	-- transcript_status: 'pending' | 'ready' | 'failed' | NULL (never transcribed)
	transcript_status    TEXT,
	transcript_text      TEXT,
	transcript_lang      TEXT,
	transcript_updated_at INTEGER
);
-- Primary lookup index.
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
-- Note: idx_attachments_transcript_status is created in db.ts after the
-- ensureColumn migrations that add transcript_status to existing tables.
-- It cannot live here because for existing DBs this schema block runs before
-- the columns exist (CREATE TABLE IF NOT EXISTS is a no-op on existing tables).

CREATE TABLE IF NOT EXISTS sessions (
	id          TEXT PRIMARY KEY,
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
	last_seen   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS magic_links (
	token        TEXT PRIMARY KEY,
	user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	ticket_id    INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
	expires_at   INTEGER NOT NULL,
	used_at      INTEGER,
	created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_magic_user ON magic_links(user_id);

-- ─── User ↔ Project assignments ───────────────────────────────────────────
-- An admin assigns users to projects. A user can only see projects in
-- this table (plus projects they themselves created via "+add" on a
-- ticket, which auto-insert a row here at creation time).
CREATE TABLE IF NOT EXISTS user_projects (
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_user_projects_user    ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_project ON user_projects(project_id);

-- ─── Groups (sub-units inside a project) ──────────────────────────────────
-- A project can host any number of named groups. A ticket may be tagged
-- with at most one group (tickets.group_id). Group membership grants
-- visibility: every user in a group sees every ticket tagged with that
-- group, regardless of who owns the ticket. Without a group, tickets are
-- private to owner/assignee/follower/admin (the strict default).
CREATE TABLE IF NOT EXISTS groups (
	id                  INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	name                TEXT NOT NULL,
	created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
	created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
	UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_groups_project ON groups(project_id);

CREATE TABLE IF NOT EXISTS group_users (
	group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_users_user ON group_users(user_id);

-- ─── Per-user read state on tickets ───────────────────────────────────────
-- `last_read_at` is the timestamp the user last fully read the ticket;
-- any message in the ticket with created_at > last_read_at and a sender
-- other than this user is considered "unread" for them. A NULL row
-- (i.e. user has never opened the ticket) means everything is unread.
CREATE TABLE IF NOT EXISTS ticket_reads (
	ticket_id        INTEGER NOT NULL REFERENCES tickets(id)   ON DELETE CASCADE,
	user_id          INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
	last_read_at     INTEGER NOT NULL DEFAULT (unixepoch()),
	last_read_msg_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
	PRIMARY KEY (ticket_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ticket_reads_user ON ticket_reads(user_id);

-- ─── Persistent rate-limit counters ───────────────────────────────────────
-- Keyed by an arbitrary string (typically "route:ip"). Survives container
-- restarts so brute-force windows are not reset on deploy.
CREATE TABLE IF NOT EXISTS rate_limits (
	key          TEXT PRIMARY KEY,
	count        INTEGER NOT NULL DEFAULT 0,
	window_start INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- ─── Pending tasks on tickets ─────────────────────────────────────────────
-- A free-form todo item assigned to a participant of a ticket. Admins and
-- the ticket owner can create them; the assignee and admins can flip the
-- completed flag. Multiple open tasks per (ticket, user) are allowed —
-- the UI lists them together. `completed_at IS NULL` means the task is
-- still pending; a non-null value records the time + actor.
CREATE TABLE IF NOT EXISTS ticket_tasks (
	id                   INTEGER PRIMARY KEY,
	ticket_id            INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
	assignee_user_id     INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
	created_by_user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
	title                TEXT    NOT NULL,
	description          TEXT    NOT NULL DEFAULT '',
	completed_at         INTEGER,
	completed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
	created_at           INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_open ON ticket_tasks(assignee_user_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_ticket        ON ticket_tasks(ticket_id);

-- ─── Per-user email throttle ──────────────────────────────────────────────
-- Stores the epoch of the most recent email sent for each (user, kind) pair.
-- Used to enforce one email per calendar day per kind; the PRIMARY KEY covers
-- every read pattern so no extra index is needed. `kind` is an open TEXT so
-- future categories do not require schema migrations.
CREATE TABLE IF NOT EXISTS email_throttle (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  last_sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- ─── Chunked upload sessions (Sprint 33) ─────────────────────────────────
-- Tracks in-flight tus.io resumable uploads. One row per upload attempt.
-- The partial file lives at `partial_path` until assembly completes, at
-- which point it is renamed to the final stored path and the row is marked
-- 'complete'. Sessions expire after 24 h; the cleanup job prunes them.
CREATE TABLE IF NOT EXISTS upload_sessions (
  id              TEXT PRIMARY KEY,       -- 32-char base64url random id
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  total_bytes     INTEGER NOT NULL,
  received_bytes  INTEGER NOT NULL DEFAULT 0,
  partial_path    TEXT NOT NULL,          -- pre-complete: absolute .part path; post-complete: storedName under uploadDir
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','assembling','complete','attached','aborted','expired')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at      INTEGER NOT NULL        -- unixepoch() + 86400
);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_user
  ON upload_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires
  ON upload_sessions(expires_at) WHERE status = 'open';

-- ─── API tokens (agent access) ─────────────────────────────────────────────
-- Personal bearer tokens for coding agents. Only the SHA-256 of the token is
-- stored. A token with ticket_id is limited to that ticket; can_reply lets the
-- agent post replies and change status. Tokens expire (96 h) and can be
-- revoked; they are only honoured on /api/v1/*.
CREATE TABLE IF NOT EXISTS api_tokens (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name          TEXT NOT NULL,
	token_hash    TEXT NOT NULL UNIQUE,
	token_prefix  TEXT NOT NULL,
	ticket_id     INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
	can_reply     INTEGER NOT NULL DEFAULT 0,
	expires_at    INTEGER NOT NULL,
	created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
	last_used_at  INTEGER,
	revoked_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- ─── One-time "choose your password" links ────────────────────────────────
-- Emailed instead of a password: welcome (new account), admin reset and
-- self-service "forgot password". Only the SHA-256 of the token is stored, a
-- link is single use and expires, and a newer link replaces older unused ones.
CREATE TABLE IF NOT EXISTS password_tokens (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash  TEXT NOT NULL UNIQUE,
	purpose     TEXT NOT NULL,
	expires_at  INTEGER NOT NULL,
	created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
	used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_password_tokens_user ON password_tokens(user_id);

-- ─── Passkeys (WebAuthn) ──────────────────────────────────────────────────
-- Public-key credentials a user registered to sign in without a password.
-- Only the public key is stored. `webauthn_challenges` holds the one-time
-- challenge of an in-flight registration or sign-in (5 minutes, single use).
CREATE TABLE IF NOT EXISTS passkeys (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	credential_id  TEXT NOT NULL UNIQUE,
	public_key     TEXT NOT NULL,
	counter        INTEGER NOT NULL DEFAULT 0,
	transports     TEXT,
	device_type    TEXT NOT NULL,
	backed_up      INTEGER NOT NULL DEFAULT 0,
	name           TEXT NOT NULL,
	created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
	last_used_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
	id          TEXT PRIMARY KEY,
	purpose     TEXT NOT NULL,
	user_id     INTEGER,
	challenge   TEXT NOT NULL,
	expires_at  INTEGER NOT NULL
);

-- One-time data migrations already applied (see db.ts).
CREATE TABLE IF NOT EXISTS app_meta (
	key    TEXT PRIMARY KEY,
	value  TEXT NOT NULL,
	set_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─── Deadline reminders ───────────────────────────────────────────────────
-- Per-user preferences (no row = defaults, everything on) and a log of what
-- was already sent, so restarts and overlapping runs never repeat an email.
CREATE TABLE IF NOT EXISTS reminder_prefs (
	user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	tz               TEXT,
	work_days        INTEGER NOT NULL DEFAULT 31,    -- bit0 Mon .. bit6 Sun
	work_start       INTEGER NOT NULL DEFAULT 540,   -- minutes from midnight
	work_end         INTEGER NOT NULL DEFAULT 1080,
	due_soon_enabled INTEGER NOT NULL DEFAULT 1,
	due_soon_hours   INTEGER NOT NULL DEFAULT 24,
	digest_enabled   INTEGER NOT NULL DEFAULT 1,
	digest_time      INTEGER NOT NULL DEFAULT 540,
	overdue_enabled  INTEGER NOT NULL DEFAULT 1,
	overdue_weekday  INTEGER NOT NULL DEFAULT 2,     -- 0 Sun .. 6 Sat (Tuesday)
	overdue_time     INTEGER NOT NULL DEFAULT 540,
	updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS reminder_log (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind       TEXT NOT NULL,          -- due-soon | digest | overdue-weekly
	period_key TEXT NOT NULL,          -- local date, ISO week or the ticket's due time
	ticket_id  INTEGER NOT NULL DEFAULT 0,
	item_count INTEGER NOT NULL DEFAULT 0,
	sent_at    INTEGER NOT NULL DEFAULT (unixepoch()),
	UNIQUE (user_id, kind, period_key, ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_reminder_log_sent ON reminder_log(sent_at);

-- ─── Response-time extensions ─────────────────────────────────────────────
-- Anyone with access to an open ticket can ask for more time, with a written
-- reason (like marking a ticket urgent). The deadline moves immediately and
-- the request is kept, visible to everyone on the ticket.
CREATE TABLE IF NOT EXISTS ticket_extensions (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
	user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
	hours        INTEGER NOT NULL,
	reason       TEXT NOT NULL,
	previous_due INTEGER NOT NULL,
	new_due      INTEGER NOT NULL,
	created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ticket_extensions_ticket ON ticket_extensions(ticket_id);
