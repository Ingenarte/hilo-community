import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { SCHEDULES } from '$lib/server/schedule';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	const schedule =
		(db.prepare('SELECT email_schedule FROM users WHERE id = ?').get(locals.user.id) as
			| { email_schedule: string }
			| undefined)?.email_schedule ?? 'immediate';
	return { schedule, schedulePresets: SCHEDULES };
};
