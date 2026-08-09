import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	listAdmins,
	listProjectsWithCounts,
	listTemplates,
	listWebhooks
} from '$lib/server/tickets';
import { db } from '$lib/server/db';
import { SCHEDULES } from '$lib/server/schedule';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const schedule =
		(db.prepare('SELECT email_schedule FROM users WHERE id = ?').get(locals.user.id) as
			| { email_schedule: string }
			| undefined)?.email_schedule ?? 'immediate';

	return {
		admins: listAdmins(),
		templates: listTemplates(),
		webhooks: listWebhooks(),
		projects: listProjectsWithCounts(),
		schedule,
		schedulePresets: SCHEDULES
	};
};
