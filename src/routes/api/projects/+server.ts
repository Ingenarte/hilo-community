import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/**
 * GET /api/projects
 * Returns the projects visible to the current user:
 *   - admin: all non-archived projects
 *   - regular user: only projects in user_projects for that user
 */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	if (locals.user.role === 'admin') {
		const rows = db
			.prepare(
				`SELECT id, name, slug, status FROM projects WHERE status != 'archived' ORDER BY name`
			)
			.all();
		return json({ projects: rows });
	}

	const rows = db
		.prepare(
			`SELECT p.id, p.name, p.slug, p.status
			 FROM projects p
			 JOIN user_projects up ON up.project_id = p.id
			 WHERE up.user_id = ? AND p.status != 'archived'
			 ORDER BY p.name`
		)
		.all(locals.user.id);
	return json({ projects: rows });
};
