import { db } from './db';
import { timezoneFor } from './schedule';
import { DEFAULT_REMINDER_PREFS, type ReminderPrefs, validateReminderPrefs } from '$lib/reminderRules';

type Row = {
	tz: string | null;
	work_days: number;
	work_start: number;
	work_end: number;
	due_soon_enabled: number;
	due_soon_hours: number;
	digest_enabled: number;
	digest_time: number;
	overdue_enabled: number;
	overdue_weekday: number;
	overdue_time: number;
};

/** Zone used when the user has not chosen one: their email-schedule zone, else the server default. */
export function fallbackTimeZone(userId: number): string {
	const row = db.prepare('SELECT email_schedule FROM users WHERE id = ?').get(userId) as
		| { email_schedule: string | null }
		| undefined;
	const fromSchedule = row?.email_schedule ? timezoneFor(row.email_schedule) : null;
	return fromSchedule ?? process.env.DEFAULT_TIMEZONE ?? 'Europe/Rome';
}

/** Saved preferences, or the defaults when the user never opened the form. */
export function getReminderPrefs(userId: number): ReminderPrefs & { effectiveTz: string } {
	const r = db.prepare('SELECT * FROM reminder_prefs WHERE user_id = ?').get(userId) as Row | undefined;
	const prefs: ReminderPrefs = r
		? {
				tz: r.tz,
				workDays: r.work_days,
				workStart: r.work_start,
				workEnd: r.work_end,
				dueSoonEnabled: r.due_soon_enabled === 1,
				dueSoonHours: r.due_soon_hours,
				digestEnabled: r.digest_enabled === 1,
				digestTime: r.digest_time,
				overdueEnabled: r.overdue_enabled === 1,
				overdueWeekday: r.overdue_weekday,
				overdueTime: r.overdue_time
			}
		: { ...DEFAULT_REMINDER_PREFS };
	return { ...prefs, effectiveTz: prefs.tz ?? fallbackTimeZone(userId) };
}

export function saveReminderPrefs(
	userId: number,
	prefs: ReminderPrefs
): { ok: true } | { ok: false; field: string; message: string } {
	const problem = validateReminderPrefs(prefs);
	if (problem) return { ok: false, ...problem };
	db.prepare(
		`INSERT INTO reminder_prefs
		   (user_id, tz, work_days, work_start, work_end, due_soon_enabled, due_soon_hours,
		    digest_enabled, digest_time, overdue_enabled, overdue_weekday, overdue_time, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
		 ON CONFLICT(user_id) DO UPDATE SET
		   tz = excluded.tz, work_days = excluded.work_days, work_start = excluded.work_start,
		   work_end = excluded.work_end, due_soon_enabled = excluded.due_soon_enabled,
		   due_soon_hours = excluded.due_soon_hours, digest_enabled = excluded.digest_enabled,
		   digest_time = excluded.digest_time, overdue_enabled = excluded.overdue_enabled,
		   overdue_weekday = excluded.overdue_weekday, overdue_time = excluded.overdue_time,
		   updated_at = unixepoch()`
	).run(
		userId,
		prefs.tz,
		prefs.workDays,
		prefs.workStart,
		prefs.workEnd,
		prefs.dueSoonEnabled ? 1 : 0,
		prefs.dueSoonHours,
		prefs.digestEnabled ? 1 : 0,
		prefs.digestTime,
		prefs.overdueEnabled ? 1 : 0,
		prefs.overdueWeekday,
		prefs.overdueTime
	);
	return { ok: true };
}
