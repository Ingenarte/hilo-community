/**
 * Projects: CRUD + slugification + ticket↔project linking.
 *
 * Everything that touches `projects` or `ticket_projects` lives here.
 */

import { db } from './db';
import type { DBProject } from './db';

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'project'
	);
}

export function getTicketProjects(ticketId: number): DBProject[] {
	return db
		.prepare(
			`SELECT p.* FROM projects p
			 JOIN ticket_projects tp ON tp.project_id = p.id
			 WHERE tp.ticket_id = ?
			 ORDER BY p.name`
		)
		.all(ticketId) as DBProject[];
}

export function getTicketProjectNames(ticketId: number): string[] {
	return getTicketProjects(ticketId).map((p) => p.name);
}

/**
 * Batch variant of `getTicketProjectNames` — fetches project names for
 * many tickets in one query and returns them keyed by ticket id. Use
 * this when rendering a list of tickets so the inbox no longer fires
 * one extra query per row.
 */
export function getProjectNamesByTicketIds(ticketIds: number[]): Map<number, string[]> {
	const result = new Map<number, string[]>();
	if (ticketIds.length === 0) return result;
	const placeholders = ticketIds.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`SELECT tp.ticket_id, p.name
			 FROM ticket_projects tp
			 JOIN projects p ON p.id = tp.project_id
			 WHERE tp.ticket_id IN (${placeholders})
			 ORDER BY tp.ticket_id, p.name`
		)
		.all(...ticketIds) as Array<{ ticket_id: number; name: string }>;
	for (const row of rows) {
		const names = result.get(row.ticket_id);
		if (names) names.push(row.name);
		else result.set(row.ticket_id, [row.name]);
	}
	return result;
}

/**
 * Returns project ids matching the supplied names. New names are created on the fly.
 */
export function resolveProjectNames(names: string[]): number[] {
	const ids: number[] = [];
	const seen = new Set<string>();
	const findStmt = db.prepare('SELECT id, slug FROM projects WHERE name = ? COLLATE NOCASE');
	const insStmt = db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)');
	const slugStmt = db.prepare('SELECT id FROM projects WHERE slug = ?');

	for (const raw of names) {
		const name = raw.trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const found = findStmt.get(name) as { id: number; slug: string } | undefined;
		if (found) {
			ids.push(found.id);
			continue;
		}
		let slug = slugify(name);
		let suffix = 0;
		while (slugStmt.get(slug)) {
			suffix += 1;
			slug = `${slugify(name)}-${suffix}`;
		}
		try {
			const info = insStmt.run(name, slug);
			ids.push(Number(info.lastInsertRowid));
		} catch {
			const retry = findStmt.get(name) as { id: number } | undefined;
			if (retry) ids.push(retry.id);
		}
	}
	return ids;
}

export function listProjects(): DBProject[] {
	return db.prepare('SELECT * FROM projects ORDER BY name').all() as DBProject[];
}

/** Projects that accept new tickets (admin catalogue minus archived and awaiting approval). */
export function listActiveProjects(): DBProject[] {
	return db
		.prepare(`SELECT * FROM projects WHERE status NOT IN ('archived', 'pending') ORDER BY name`)
		.all() as DBProject[];
}

/**
 * Projects visible to a given non-admin user — the subset of active projects
 * that the admin has assigned to them in `user_projects`. Admins should call
 * `listProjects()` directly to see the full catalogue.
 */
export function listProjectsForUser(userId: number): DBProject[] {
	return db
		.prepare(
			`SELECT p.* FROM projects p
			 JOIN user_projects up ON up.project_id = p.id
			 WHERE up.user_id = ? AND p.status NOT IN ('archived', 'pending')
			 ORDER BY p.name`
		)
		.all(userId) as DBProject[];
}

export function listProjectsWithCounts(): Array<DBProject & { ticket_count: number }> {
	return db
		.prepare(
			`SELECT p.*,
			        (SELECT COUNT(*) FROM ticket_projects tp WHERE tp.project_id = p.id) AS ticket_count
			 FROM projects p ORDER BY p.name`
		)
		.all() as Array<DBProject & { ticket_count: number }>;
}

export type PendingProject = {
	id: number;
	name: string;
	slug: string;
	created_at: number;
	requested_by: { id: number; email: string } | null;
	tickets: Array<{ id: number; title: string }>;
};

/** Projects a user asked for with "+ Add" that an admin has not approved yet. */
export function listPendingProjects(): PendingProject[] {
	const rows = db
		.prepare(
			`SELECT p.id, p.name, p.slug, p.created_at, u.id AS uid, u.email AS uemail
			 FROM projects p LEFT JOIN users u ON u.id = p.created_by_user_id
			 WHERE p.status = 'pending' ORDER BY p.created_at`
		)
		.all() as Array<{
		id: number;
		name: string;
		slug: string;
		created_at: number;
		uid: number | null;
		uemail: string | null;
	}>;
	const ticketsStmt = db.prepare(
		`SELECT t.id, t.title FROM tickets t JOIN ticket_projects tp ON tp.ticket_id = t.id
		 WHERE tp.project_id = ? ORDER BY t.id`
	);
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		slug: r.slug,
		created_at: r.created_at,
		requested_by: r.uid ? { id: r.uid, email: r.uemail ?? '' } : null,
		tickets: ticketsStmt.all(r.id) as Array<{ id: number; title: string }>
	}));
}

/**
 * Approves a requested project: it becomes active and its requester is assigned
 * to it so they can file further tickets there. Returns false when the project
 * is not awaiting approval.
 */
export function approveProject(id: number): { requesterId: number | null } | null {
	const row = db
		.prepare(`SELECT status, created_by_user_id FROM projects WHERE id = ?`)
		.get(id) as { status: string; created_by_user_id: number | null } | undefined;
	if (!row || row.status !== 'pending') return null;
	db.transaction(() => {
		db.prepare(`UPDATE projects SET status = 'active' WHERE id = ?`).run(id);
		if (row.created_by_user_id) {
			db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)').run(
				row.created_by_user_id,
				id
			);
		}
	})();
	return { requesterId: row.created_by_user_id };
}

export function createProject(name: string): DBProject {
	const clean = name.trim();
	if (!clean) throw new Error('Project name is required');
	if (clean.length > 80) throw new Error('Project name is too long (max 80)');
	const exists = db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE').get(clean);
	if (exists) throw new Error('Project already exists');
	let slug = slugify(clean);
	let suffix = 0;
	while (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
		suffix += 1;
		slug = `${slugify(clean)}-${suffix}`;
	}
	const info = db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run(clean, slug);
	return {
		id: Number(info.lastInsertRowid),
		name: clean,
		slug,
		created_at: Math.floor(Date.now() / 1000)
	};
}

export function renameProject(id: number, newName: string): void {
	const clean = newName.trim();
	if (!clean) throw new Error('Project name is required');
	if (clean.length > 80) throw new Error('Project name is too long (max 80)');
	const conflict = db
		.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND id <> ?')
		.get(clean, id) as { id: number } | undefined;
	if (conflict) throw new Error('Another project already uses that name');
	db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(clean, id);
}

export function deleteProject(id: number, opts: { force?: boolean } = {}): void {
	const ticketCount = (
		db
			.prepare('SELECT COUNT(*) AS n FROM ticket_projects WHERE project_id = ?')
			.get(id) as { n: number }
	).n;
	if (ticketCount > 0 && !opts.force) {
		throw new Error(
			`Refusing to delete: ${ticketCount} ticket(s) still reference this project. Use merge or pass force=true.`
		);
	}
	db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/**
 * Move every ticket associated to `fromId` over to `intoId`, then delete the
 * source project. Idempotent if `fromId === intoId` (noop). Useful for
 * cleaning typos ("Aetherr" → "AETHER").
 */
export function mergeProjects(fromId: number, intoId: number): void {
	if (fromId === intoId) return;
	const tx = db.transaction(() => {
		const target = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(intoId);
		const source = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(fromId);
		if (!target) throw new Error('Target project not found');
		if (!source) throw new Error('Source project not found');
		db.prepare(
			`INSERT OR IGNORE INTO ticket_projects (ticket_id, project_id)
			 SELECT ticket_id, ? FROM ticket_projects WHERE project_id = ?`
		).run(intoId, fromId);
		db.prepare('DELETE FROM ticket_projects WHERE project_id = ?').run(fromId);
		db.prepare('DELETE FROM projects WHERE id = ?').run(fromId);
	});
	tx();
}

/**
 * Replace a ticket's project associations with `projectIds` atomically.
 * Used by the admin sidebar to correct a user's selection.
 */
export function setTicketProjects(ticketId: number, projectIds: number[]): void {
	const unique = Array.from(new Set(projectIds)).filter((n) => Number.isFinite(n) && n > 0);
	const tx = db.transaction(() => {
		db.prepare('DELETE FROM ticket_projects WHERE ticket_id = ?').run(ticketId);
		const ins = db.prepare(
			'INSERT OR IGNORE INTO ticket_projects (ticket_id, project_id) VALUES (?, ?)'
		);
		for (const pid of unique) ins.run(ticketId, pid);
		db.prepare('UPDATE tickets SET updated_at = unixepoch() WHERE id = ?').run(ticketId);
	});
	tx();
}
