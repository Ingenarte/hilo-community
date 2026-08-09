#!/usr/bin/env node
/**
 * Hilo · maintenance cleanup (standalone)
 *
 * Prunes:
 *   • Expired magic_links + tokens used more than 7 days ago.
 *   • Sessions whose last_seen is older than 365 days.
 *   • Orphan upload files (no matching `attachments.stored_name`).
 *
 * Reads DB + uploads paths from .env in the project root. Designed to run
 * concurrently with the live server (uses WAL, only deletes safe rows/files).
 *
 *   crontab (Sunday 04:30):
 *     30 4 * * 0  cd /opt/hilo && node scripts/cleanup.js
 *
 * Exit codes: 0 OK, 1 on error.
 */

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
	const envPath = join(ROOT, '.env');
	if (!existsSync(envPath)) return;
	const text = readFileSync(envPath, 'utf8');
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq < 0) continue;
		const key = line.slice(0, eq).trim();
		let val = line.slice(eq + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = val;
	}
}
loadEnv();

const dbPath = resolve(ROOT, process.env.DATABASE_PATH || './data/hilo.db');
const uploadsDir = resolve(ROOT, process.env.UPLOAD_DIR || './uploads');

const USED_RETAIN_DAYS = Number(process.env.HILO_USED_RETAIN_DAYS || 7);
const IDLE_SESSION_DAYS = Number(process.env.HILO_IDLE_SESSION_DAYS || 365);
const MIN_FILE_AGE_MS = Number(process.env.HILO_MIN_FILE_AGE_MS || 60_000);

if (!existsSync(dbPath)) {
	console.error(JSON.stringify({ ok: false, error: `db not found at ${dbPath}` }));
	process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const PENDING_AUTO_CLOSE_DAYS = Number(process.env.HILO_PENDING_AUTO_CLOSE_DAYS || 14);

const usedCutoff = Math.floor(Date.now() / 1000) - USED_RETAIN_DAYS * 86400;
const idleCutoff = Math.floor(Date.now() / 1000) - IDLE_SESSION_DAYS * 86400;
const pendingCutoff = Math.floor(Date.now() / 1000) - PENDING_AUTO_CLOSE_DAYS * 86400;

const magicLinksRemoved = db
	.prepare(
		`DELETE FROM magic_links
		 WHERE expires_at < unixepoch()
		    OR (used_at IS NOT NULL AND used_at < ?)`
	)
	.run(usedCutoff).changes;

const sessionsExpired = db
	.prepare('DELETE FROM sessions WHERE last_seen < ?')
	.run(idleCutoff).changes;

const ticketsAutoClosed = db
	.prepare(
		`UPDATE tickets
		 SET status = 'closed', updated_at = unixepoch()
		 WHERE status = 'pending' AND updated_at < ?`
	)
	.run(pendingCutoff).changes;

let orphanFilesRemoved = 0;
let orphanBytesFreed = 0;
if (existsSync(uploadsDir)) {
	const known = new Set(
		db
			.prepare('SELECT stored_name FROM attachments')
			.all()
			.map((r) => r.stored_name)
	);
	for (const name of readdirSync(uploadsDir)) {
		if (known.has(name)) continue;
		const full = join(uploadsDir, name);
		try {
			const st = statSync(full);
			if (!st.isFile()) continue;
			if (Date.now() - st.mtimeMs < MIN_FILE_AGE_MS) continue;
			unlinkSync(full);
			orphanFilesRemoved += 1;
			orphanBytesFreed += st.size;
		} catch {
			// ignore
		}
	}
}

function fmt(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

console.log(
	JSON.stringify(
		{
			ok: true,
			magic_links_removed: magicLinksRemoved,
			sessions_expired: sessionsExpired,
			orphan_files_removed: orphanFilesRemoved,
			orphan_bytes_freed: orphanBytesFreed,
			orphan_bytes_freed_human: fmt(orphanBytesFreed),
			tickets_auto_closed: ticketsAutoClosed
		},
		null,
		2
	)
);
