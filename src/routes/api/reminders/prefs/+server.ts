import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { assertSameOriginJson } from '$lib/server/csrf';
import { getReminderPrefs, saveReminderPrefs } from '$lib/server/reminderPrefs';
import type { ReminderPrefs } from '$lib/reminderRules';

/** GET /api/reminders/prefs -> my deadline-reminder preferences (defaults when never saved). */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const { effectiveTz, ...prefs } = getReminderPrefs(locals.user.id);
	return json({ prefs, effectiveTz }, { headers: { 'Cache-Control': 'no-store' } });
};

const bool = (v: unknown) => v === true;
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN);

/** PUT /api/reminders/prefs { ...ReminderPrefs } -> validates and saves. */
export const PUT: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	assertSameOriginJson(request, url);
	const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!b || typeof b !== 'object') throw error(400, 'JSON body required');

	const tz = b.tz === null || b.tz === '' || b.tz === undefined ? null : String(b.tz);
	const prefs: ReminderPrefs = {
		tz,
		workDays: int(b.workDays),
		workStart: int(b.workStart),
		workEnd: int(b.workEnd),
		dueSoonEnabled: bool(b.dueSoonEnabled),
		dueSoonHours: int(b.dueSoonHours),
		digestEnabled: bool(b.digestEnabled),
		digestTime: int(b.digestTime),
		overdueEnabled: bool(b.overdueEnabled),
		overdueWeekday: int(b.overdueWeekday),
		overdueTime: int(b.overdueTime)
	};
	const result = saveReminderPrefs(locals.user.id, prefs);
	if (!result.ok) return json({ error: result.message, field: result.field }, { status: 400 });
	audit('reminders.prefs_saved', { actor: locals.user, target: `user:${locals.user.id}` });
	const { effectiveTz, ...saved } = getReminderPrefs(locals.user.id);
	return json({ ok: true, prefs: saved, effectiveTz });
};
