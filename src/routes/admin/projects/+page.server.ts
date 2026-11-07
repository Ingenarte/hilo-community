import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listPendingProjects } from '$lib/server/tickets';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const projects = db
		.prepare(
			`SELECT p.id, p.name, p.slug, p.status, p.created_at,
			        COUNT(tp.ticket_id) AS ticket_count
			 FROM projects p
			 LEFT JOIN ticket_projects tp ON tp.project_id = p.id
			 WHERE p.status != 'pending'
			 GROUP BY p.id
			 ORDER BY p.created_at DESC`
		)
		.all() as Array<{
		id: number;
		name: string;
		slug: string;
		status: 'active' | 'archived';
		created_at: number;
		ticket_count: number;
	}>;

	const pending = listPendingProjects();
	const targets = projects.filter((p) => p.status === 'active').map((p) => ({ id: p.id, name: p.name }));
	return { projects, pending, targets };
};
