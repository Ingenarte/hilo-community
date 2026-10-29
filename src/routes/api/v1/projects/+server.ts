import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAuth, limited, v1Json } from '$lib/server/apiV1';

/** GET /api/v1/projects : projects the token's user can file tickets under. */
export const GET: RequestHandler = ({ locals }) => {
	const auth = requireAuth(locals);
	if (auth instanceof Response) return auth;
	const rl = limited(auth.token, 'read', 120, 60);
	if (rl) return rl;

	let rows: Array<{ id: number; name: string; slug: string }>;
	if (auth.token.ticketId !== null) {
		rows = db
			.prepare(
				`SELECT p.id, p.name, p.slug FROM projects p
				 JOIN ticket_projects tp ON tp.project_id = p.id WHERE tp.ticket_id = ? ORDER BY p.name`
			)
			.all(auth.token.ticketId) as typeof rows;
	} else if (auth.user.role === 'admin') {
		rows = db
			.prepare("SELECT id, name, slug FROM projects WHERE status != 'archived' ORDER BY name")
			.all() as typeof rows;
	} else {
		rows = db
			.prepare(
				`SELECT p.id, p.name, p.slug FROM projects p
				 JOIN user_projects up ON up.project_id = p.id
				 WHERE up.user_id = ? AND p.status != 'archived' ORDER BY p.name`
			)
			.all(auth.user.id) as typeof rows;
	}
	return v1Json({ projects: rows });
};
