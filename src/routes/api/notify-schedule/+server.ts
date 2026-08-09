import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { isKnownSchedule, SCHEDULES } from '$lib/server/schedule';

/**
 * GET  → list of available presets (immediate + regional + custom).
 * POST { schedule } → persist the user's preference. Accepts a preset key
 *        OR a raw IANA timezone string (e.g. 'Pacific/Auckland').
 */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const current = (
		db.prepare('SELECT email_schedule FROM users WHERE id = ?').get(locals.user.id) as
			| { email_schedule: string }
			| undefined
	)?.email_schedule ?? 'immediate';
	return json({ current, presets: SCHEDULES });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	let schedule: string | undefined;
	const ctype = request.headers.get('content-type') || '';
	if (ctype.includes('application/json')) {
		const data = (await request.json().catch(() => ({}))) as { schedule?: string };
		schedule = data.schedule;
	} else {
		const form = await request.formData();
		schedule = String(form.get('schedule') || '');
	}
	if (!schedule || !isKnownSchedule(schedule))
		return json({ error: 'Unknown schedule key or invalid IANA timezone.' }, { status: 400 });

	db.prepare('UPDATE users SET email_schedule = ? WHERE id = ?').run(schedule, locals.user.id);
	return json({ ok: true, schedule });
};
