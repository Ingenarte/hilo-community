/**
 * Admin-only catalogue helpers: admin users, response templates, webhooks.
 *
 * Out of the original tickets god-module. Each function is a pure SQLite
 * statement; no business orchestration beyond "last admin can't be
 * demoted" (would lock the instance).
 */

import { db } from './db';

// ─── Admin users ────────────────────────────────────────────────────────────

export function getAdminUser(): { id: number; email: string } {
	const row = db
		.prepare("SELECT id, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
		.get() as { id: number; email: string } | undefined;
	if (!row) throw new Error('No admin user provisioned');
	return row;
}

export function listAdmins(): Array<{ id: number; email: string }> {
	return db
		.prepare("SELECT id, email FROM users WHERE role = 'admin' ORDER BY email")
		.all() as Array<{ id: number; email: string }>;
}

/**
 * Users that make sense to show in a ticket's "Assigned to" dropdown:
 *   - every admin (always — they can act on any ticket)
 *   - every non-admin user that shares a project with the ticket via
 *     user_projects (they're already allowed to see the ticket; making
 *     them eligible assignees is the natural extension)
 *   - the ticket owner (defensive — covers the corner case where the
 *     owner lost their user_projects row after creation)
 * Disabled accounts are excluded. Result is deduplicated and sorted with
 * admins first, then by email.
 */
export function listAssignableForTicket(
	ticketId: number
): Array<{ id: number; email: string; role: 'user' | 'admin' }> {
	return db
		.prepare(
			`SELECT DISTINCT u.id, u.email, u.role
			 FROM users u
			 WHERE u.disabled_at IS NULL
			   AND (
			     u.role = 'admin'
			     OR u.id = (SELECT user_id FROM tickets WHERE id = ?)
			     OR EXISTS (
			       SELECT 1 FROM user_projects up
			       JOIN ticket_projects tp ON tp.project_id = up.project_id
			       WHERE tp.ticket_id = ? AND up.user_id = u.id
			     )
			   )
			 ORDER BY u.role = 'admin' DESC, u.email`
		)
		.all(ticketId, ticketId) as Array<{ id: number; email: string; role: 'user' | 'admin' }>;
}

export function promoteUserToAdmin(email: string): { id: number; email: string } {
	const normalised = email.toLowerCase().trim();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
		throw new Error('Invalid email');
	}
	const existing = db
		.prepare('SELECT id, email FROM users WHERE email = ?')
		.get(normalised) as { id: number; email: string } | undefined;
	if (existing) {
		db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
		return existing;
	}
	const info = db.prepare("INSERT INTO users (email, role) VALUES (?, 'admin')").run(normalised);
	return { id: Number(info.lastInsertRowid), email: normalised };
}

export function demoteAdmin(userId: number): boolean {
	// Refuse to demote the last admin — would lock the instance.
	const adminCount = (
		db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }
	).n;
	if (adminCount <= 1) return false;
	db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(userId);
	return true;
}

// ─── Canned response templates ─────────────────────────────────────────────

export function listTemplates(): Array<{ id: number; title: string; body: string }> {
	return db.prepare('SELECT id, title, body FROM templates ORDER BY title').all() as Array<{
		id: number;
		title: string;
		body: string;
	}>;
}

export function createTemplate(args: {
	title: string;
	body: string;
	createdBy: number;
}): number {
	const info = db
		.prepare('INSERT INTO templates (title, body, created_by) VALUES (?, ?, ?)')
		.run(args.title.slice(0, 120), args.body, args.createdBy);
	return Number(info.lastInsertRowid);
}

export function deleteTemplate(id: number): void {
	db.prepare('DELETE FROM templates WHERE id = ?').run(id);
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

export function listWebhooks(): Array<{
	id: number;
	name: string;
	url: string;
	kind: 'slack' | 'discord' | 'generic';
	events: string;
	enabled: 0 | 1;
}> {
	return db.prepare('SELECT id, name, url, kind, events, enabled FROM webhooks ORDER BY id').all() as Array<{
		id: number;
		name: string;
		url: string;
		kind: 'slack' | 'discord' | 'generic';
		events: string;
		enabled: 0 | 1;
	}>;
}

export function createWebhook(args: {
	name: string;
	url: string;
	kind: 'slack' | 'discord' | 'generic';
	events: string;
}): number {
	const info = db
		.prepare('INSERT INTO webhooks (name, url, kind, events) VALUES (?, ?, ?, ?)')
		.run(args.name.slice(0, 80), args.url, args.kind, args.events);
	return Number(info.lastInsertRowid);
}

export function deleteWebhook(id: number): void {
	db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
}

export function setWebhookEnabled(id: number, enabled: boolean): void {
	db.prepare('UPDATE webhooks SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}
