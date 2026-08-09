import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { createTicket } from '$lib/server/tickets';
import { audit } from '$lib/server/audit';

/**
 * POST /api/tickets
 * JSON body: { title, body, priority?, projectId?, newProjectName? }
 *
 * Rules (sprint-26may):
 *  - A ticket MUST be associated with a project. No project → 400.
 *  - `projectId`: must be a project the user is assigned to (admins bypass).
 *  - `newProjectName`: creates a new project with status='active' and
 *    auto-assigns the user to it. The admin can rename or archive it.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = (await request.json().catch(() => ({}))) as {
		title?: string;
		body?: string;
		priority?: string;
		projectId?: number;
		newProjectName?: string;
	};

	const title = String(body.title || '').trim();
	const messageBody = String(body.body || '').trim();
	if (!title) throw error(400, 'title is required');
	if (!messageBody) throw error(400, 'body is required');

	let projectId: number;

	if (body.newProjectName && String(body.newProjectName).trim()) {
		const name = String(body.newProjectName).trim();
		// Build a slug, handling collisions with a numeric suffix
		const slugify = (s: string) =>
			s
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '')
				.slice(0, 60) || 'project';

		let slug = slugify(name);
		let suffix = 0;
		while (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
			suffix += 1;
			slug = `${slugify(name)}-${suffix}`;
		}

		const info = db
			.prepare(
				`INSERT INTO projects (name, slug, status, created_by_user_id)
				 VALUES (?, ?, 'active', ?)`
			)
			.run(name, slug, locals.user.id);
		projectId = Number(info.lastInsertRowid);

		// Auto-assign the creating user to the new project
		db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)').run(
			locals.user.id,
			projectId
		);
	} else if (typeof body.projectId === 'number') {
		// Validate that the user is assigned to this project (admins bypass)
		if (locals.user.role !== 'admin') {
			const ok = db
				.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?')
				.get(locals.user.id, body.projectId);
			if (!ok) throw error(403, 'You are not assigned to this project');
		}
		projectId = body.projectId;
	} else {
		throw error(400, 'A project is required');
	}

	const ticketId = createTicket({ userId: locals.user.id, title, projectIds: [projectId] });

	audit('ticket.created', {
		actor: locals.user,
		target: `ticket:${ticketId}`,
		detail: { title, projectId }
	});

	return json({ ok: true, ticketId });
};
