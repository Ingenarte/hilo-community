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
			 WHERE up.user_id = ? AND p.status != 'archived'
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
