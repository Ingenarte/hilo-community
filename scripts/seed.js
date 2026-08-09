#!/usr/bin/env node
/**
 * Hilo · dev seed
 *
 * Populates the DB with a handful of users, projects, tickets and messages
 * so the UI looks alive when contributors clone the repo.
 *
 *   node scripts/seed.js          # idempotent: skips if seed users already exist
 *   node scripts/seed.js --reset  # wipes ticket data first (keeps admin)
 *
 * Note: needs the same .env Hilo reads from at runtime — uses the same
 * DATABASE_PATH and ADMIN_EMAIL.
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reset = process.argv.includes('--reset');

function loadEnv() {
	const envPath = join(ROOT, '.env');
	if (!existsSync(envPath)) return;
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const l = line.trim();
		if (!l || l.startsWith('#')) continue;
		const i = l.indexOf('=');
		if (i < 0) continue;
		const k = l.slice(0, i).trim();
		let v = l.slice(i + 1).trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
			v = v.slice(1, -1);
		}
		if (process.env[k] === undefined) process.env[k] = v;
	}
}
loadEnv();

const dbPath = resolve(ROOT, process.env.DATABASE_PATH || './data/hilo.db');
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();

if (!existsSync(dbPath)) {
	console.error(`db not found at ${dbPath} — start the server once first.`);
	process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

if (reset) {
	console.log('reset: clearing non-admin tickets, messages, attachments, magic_links, sessions');
	db.exec('DELETE FROM magic_links; DELETE FROM sessions; DELETE FROM attachments; DELETE FROM messages; DELETE FROM reactions; DELETE FROM tickets;');
}

// ─── Users ────────────────────────────────────────────────────────────────
const SEED_EMAILS = ['alice@example.com', 'bob@example.com', 'carol@example.com'];
for (const email of SEED_EMAILS) {
	const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
	if (existing) continue;
	db.prepare("INSERT INTO users (email, role, theme, accent) VALUES (?, 'user', 'dark', 'violet')").run(email);
}

const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
if (!admin) {
	console.error(`admin user ${adminEmail} not provisioned — start the server once first.`);
	process.exit(1);
}

// ─── Projects ─────────────────────────────────────────────────────────────
const PROJECTS = ['AETHER', 'BACKEND', 'MOBILE', 'BILLING'];
for (const name of PROJECTS) {
	const exists = db.prepare('SELECT 1 FROM projects WHERE name = ? COLLATE NOCASE').get(name);
	if (!exists) {
		db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run(
			name,
			name.toLowerCase()
		);
	}
}

// ─── Tickets + messages ───────────────────────────────────────────────────
const SCENARIOS = [
	{
		email: 'alice@example.com',
		title: 'Cannot upload large videos',
		body: 'Uploading a 15 MB MP4 returns "size limit" but the docs say 20 MB. Am I missing something?',
		project: 'AETHER',
		priority: 'high',
		messages: [
			{ from: 'admin', body: 'Thanks for the report — looking into it now. What browser?' },
			{ from: 'user', body: 'Firefox 128 on Linux. Same on Chrome 120.' }
		]
	},
	{
		email: 'bob@example.com',
		title: 'Feature request: dark-only billing emails',
		body: 'The billing email card looks great in dark mode but renders white on white in Outlook light.',
		project: 'BILLING',
		priority: 'normal',
		messages: [{ from: 'admin', body: 'Good catch — added to the queue.' }]
	},
	{
		email: 'carol@example.com',
		title: '🔥 prod is down',
		body: '500 across the board, started 14:02 UTC. Logs attached when I can get them.',
		project: 'BACKEND',
		priority: 'urgent',
		messages: [
			{ from: 'admin', body: 'On it, paging the on-call.' },
			{ from: 'admin', body: 'Found it — bad config rollback. Recovering now.', internal: true },
			{ from: 'admin', body: "We're rolling back. ETA 5 min." }
		]
	}
];

const findUser = db.prepare('SELECT id FROM users WHERE email = ?');
const findProject = db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE');
const insTicket = db.prepare(
	"INSERT INTO tickets (user_id, title, priority) VALUES (?, ?, ?)"
);
const insTicketProject = db.prepare(
	'INSERT OR IGNORE INTO ticket_projects (ticket_id, project_id) VALUES (?, ?)'
);
const insMessage = db.prepare(
	'INSERT INTO messages (ticket_id, sender_id, sender_role, body, internal) VALUES (?, ?, ?, ?, ?)'
);

let created = 0;
for (const s of SCENARIOS) {
	const u = findUser.get(s.email);
	if (!u) continue;
	const existingTicket = db
		.prepare('SELECT 1 FROM tickets WHERE user_id = ? AND title = ?')
		.get(u.id, s.title);
	if (existingTicket) continue;
	const info = insTicket.run(u.id, s.title, s.priority);
	const ticketId = Number(info.lastInsertRowid);
	const p = findProject.get(s.project);
	if (p) insTicketProject.run(ticketId, p.id);
	insMessage.run(ticketId, u.id, 'user', s.body, 0);
	for (const m of s.messages) {
		const senderId = m.from === 'admin' ? admin.id : u.id;
		insMessage.run(ticketId, senderId, m.from, m.body, m.internal ? 1 : 0);
	}
	created += 1;
}

// ─── Templates ────────────────────────────────────────────────────────────
const SEED_TEMPLATES = [
	{ title: 'Acknowledged', body: 'Got it — thanks for the report. Looking into it now.' },
	{ title: 'Need repro', body: 'Could you share the exact steps you took, plus your browser + OS?' },
	{ title: 'Closing', body: 'Closing this for now — feel free to reply if it comes back.' }
];
for (const t of SEED_TEMPLATES) {
	const exists = db.prepare('SELECT 1 FROM templates WHERE title = ?').get(t.title);
	if (!exists) {
		db.prepare('INSERT INTO templates (title, body, created_by) VALUES (?, ?, ?)').run(
			t.title,
			t.body,
			admin.id
		);
	}
}

console.log(`seed done: ${created} new tickets, ${SEED_TEMPLATES.length} templates ensured`);
