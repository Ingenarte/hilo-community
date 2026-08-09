import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { audit } from '$lib/server/audit';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

/**
 * GET /api/admin/users/:id/projects
 * Returns the list of projects currently assigned to this user.
 */
export const GET: RequestHandler = ({ locals, params }) => {
	requireAdmin(locals);
	const userId = Number(params.id);
	const rows = db
		.prepare(
			`SELECT p.id, p.name, p.slug, p.status
			 FROM projects p
			 JOIN user_projects up ON up.project_id = p.id
			 WHERE up.user_id = ?
			 ORDER BY p.name`
		)
		.all(userId);
	return json({ projects: rows });
};

/**
 * PUT /api/admin/users/:id/projects  { projectIds: number[] }
 * Replaces the full project assignment for this user.
 * Tickets the user already submitted are not affected.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals);
	const userId = Number(params.id);
	const body = (await request.json().catch(() => ({}))) as { projectIds?: number[] };
	const projectIds = Array.isArray(body.projectIds)
		? body.projectIds.filter((n): n is number => Number.isFinite(n) && n > 0)
		: [];

	const trx = db.transaction(() => {
		db.prepare('DELETE FROM user_projects WHERE user_id = ?').run(userId);
		if (projectIds.length > 0) {
			const insert = db.prepare(
				'INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)'
			);
			// Only insert valid, non-archived projects
			const valid = db
				.prepare(
					`SELECT id FROM projects WHERE id IN (${projectIds.map(() => '?').join(',')}) AND status != 'archived'`
				)
				.all(...projectIds) as Array<{ id: number }>;
			for (const p of valid) insert.run(userId, p.id);
		}
	});
	trx();

	audit('user.projects.set', {
		actor: locals.user,
		target: `user:${userId}`,
		detail: { projectIds }
	});
	return json({ ok: true });
};
