import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listAllGroupsWithCounts } from '$lib/server/groups';
import { listProjects } from '$lib/server/tickets';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'admin') throw error(403, 'Forbidden');
	const groups = listAllGroupsWithCounts();
	const projects = listProjects();
	const users = db
		.prepare(
			`SELECT id, email, role FROM users
			 WHERE disabled_at IS NULL
			 ORDER BY role = 'admin' DESC, email`
		)
		.all() as Array<{ id: number; email: string; role: 'user' | 'admin' }>;
	return { groups, projects, users };
};
