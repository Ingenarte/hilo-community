import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { runReminders, sendTestReminder } from '../src/lib/server/reminders';
import { saveReminderPrefs, getReminderPrefs } from '../src/lib/server/reminderPrefs';
import { DEFAULT_REMINDER_PREFS, validateReminderPrefs, isWorkDay, workDayBit, hhmmToMinutes, minutesToHHMM } from '../src/lib/reminderRules';

const HOUR = 3600;
const at = (iso: string) => new Date(iso);
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

type Ids = { admin: number; owner: number; other: number };
function seed(): Ids {
	db.prepare(`DELETE FROM users WHERE email LIKE 'rem-%@hilo.test'`).run();
	db.prepare(`DELETE FROM tickets WHERE title LIKE 'REM %'`).run();
	const mk = (email: string, role: string) =>
		Number(db.prepare(`INSERT INTO users (email, role) VALUES (?, ?)`).run(email, role).lastInsertRowid);
	const ids = { admin: mk('rem-admin@hilo.test', 'admin'), owner: mk('rem-owner@hilo.test', 'user'), other: mk('rem-other@hilo.test', 'user') };
	for (const id of Object.values(ids)) {
		saveReminderPrefs(id, { ...DEFAULT_REMINDER_PREFS, tz: 'UTC' });
	}
	db.prepare('DELETE FROM email_outbox').run();
	return ids;
}
const ticket = (owner: number, title: string, dueSec: number | null, status = 'open', priority = 'normal') =>
	Number(
		db
			.prepare(`INSERT INTO tickets (user_id, title, priority, status, sla_due_at) VALUES (?, ?, ?, ?, ?)`)
			.run(owner, `REM ${title}`, priority, status, dueSec).lastInsertRowid
	);
const mails = (email: string) =>
	db.prepare(`SELECT subject, text_body FROM email_outbox WHERE to_email = ? ORDER BY id`).all(email) as Array<{ subject: string; text_body: string }>;
const setPrefs = (id: number, patch: Partial<typeof DEFAULT_REMINDER_PREFS>) =>
	saveReminderPrefs(id, { ...getReminderPrefs(id), ...patch, tz: patch.tz ?? 'UTC' });

describe('reminder rules', () => {
	it('works with the defaults and rejects nonsense', () => {
		expect(validateReminderPrefs({ ...DEFAULT_REMINDER_PREFS })).toBeNull();
		expect(validateReminderPrefs({ ...DEFAULT_REMINDER_PREFS, tz: 'Mars/Base' })?.field).toBe('tz');
		expect(validateReminderPrefs({ ...DEFAULT_REMINDER_PREFS, workDays: 0 })?.field).toBe('workDays');
		expect(validateReminderPrefs({ ...DEFAULT_REMINDER_PREFS, workStart: 600, workEnd: 600 })?.field).toBe('workHours');
		expect(validateReminderPrefs({ ...DEFAULT_REMINDER_PREFS, dueSoonHours: 0 })?.field).toBe('dueSoonHours');
		expect(validateReminderPrefs({ ...DEFAULT_REMINDER_PREFS, overdueWeekday: 7 })?.field).toBe('overdueWeekday');
		expect(validateReminderPrefs({ ...DEFAULT_REMINDER_PREFS, digestTime: 1440 })?.field).toBe('digestTime');
	});
	it('maps weekdays and times', () => {
		expect(isWorkDay(31, 1)).toBe(true); // Monday
		expect(isWorkDay(31, 5)).toBe(true); // Friday
		expect(isWorkDay(31, 6)).toBe(false); // Saturday
		expect(isWorkDay(31, 0)).toBe(false); // Sunday
		expect(workDayBit(0)).toBe(64);
		expect(hhmmToMinutes('09:30')).toBe(570);
		expect(hhmmToMinutes('24:00')).toBeNull();
		expect(hhmmToMinutes('9:5')).toBeNull();
		expect(minutesToHHMM(570)).toBe('09:30');
	});
});

describe('runReminders', () => {
	let ids: Ids;
	beforeEach(() => {
		ids = seed();
	});

	it('sends one daily digest with tickets due in the next 24 hours, only to people who can see them', () => {
		const now = at('2026-10-20T09:00:00Z'); // Tuesday 09:00 UTC
		ticket(ids.owner, 'mine soon', sec(now) + 5 * HOUR);
		ticket(ids.other, 'theirs soon', sec(now) + 6 * HOUR);
		ticket(ids.owner, 'later', sec(now) + 30 * HOUR);
		runReminders(now);
		const owner = mails('rem-owner@hilo.test');
		expect(owner.length).toBe(1);
		expect(owner[0].subject).toMatch(/Daily summary: 1 ticket due in the next 24 hours/);
		expect(owner[0].text_body).toContain('REM mine soon');
		expect(owner[0].text_body).not.toContain('REM theirs soon');
		expect(owner[0].text_body).not.toContain('REM later');
		const admin = mails('rem-admin@hilo.test');
		expect(admin.length).toBe(1);
		expect(admin[0].subject).toMatch(/2 tickets/);
		expect(admin[0].text_body).toContain('REM theirs soon');
	});

	it('is idempotent: running again the same day sends nothing', () => {
		const now = at('2026-10-20T09:00:00Z');
		ticket(ids.owner, 'a', sec(now) + 5 * HOUR);
		runReminders(now);
		const before = mails('rem-owner@hilo.test').length;
		runReminders(at('2026-10-20T09:05:00Z'));
		runReminders(at('2026-10-20T10:30:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(before);
	});

	it('the digest already covers those tickets, so no separate due-soon email follows', () => {
		const now = at('2026-10-20T09:00:00Z');
		ticket(ids.owner, 'a', sec(now) + 5 * HOUR);
		runReminders(now);
		runReminders(at('2026-10-20T09:10:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(1);
	});

	it('sends nothing when nothing is due', () => {
		runReminders(at('2026-10-20T09:00:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(0);
		expect(mails('rem-admin@hilo.test').length).toBe(0);
	});

	it('waits for the digest time and skips weekends and after-hours starts', () => {
		const t = at('2026-10-20T09:00:00Z');
		ticket(ids.owner, 'a', sec(t) + 5 * HOUR);
		runReminders(at('2026-10-20T08:59:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(0);
		runReminders(at('2026-10-20T09:00:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(1);

		// Saturday: no digest, even with a ticket due.
		db.prepare('DELETE FROM email_outbox').run();
		ticket(ids.owner, 'b', sec(at('2026-10-24T09:00:00Z')) + 5 * HOUR);
		runReminders(at('2026-10-24T09:30:00Z'));
		expect(mails('rem-owner@hilo.test').filter((m) => /Daily summary/.test(m.subject)).length).toBe(0);

		// A late server start after working hours does not send the digest at night.
		db.prepare('DELETE FROM reminder_log').run();
		db.prepare('DELETE FROM email_outbox').run();
		runReminders(at('2026-10-21T19:00:00Z'));
		expect(mails('rem-owner@hilo.test').filter((m) => /Daily summary/.test(m.subject)).length).toBe(0);
	});

	it('uses each person\'s own time zone', () => {
		setPrefs(ids.owner, { tz: 'America/Argentina/Buenos_Aires' }); // UTC-3
		const t = at('2026-10-20T09:00:00Z'); // 06:00 in Buenos Aires
		ticket(ids.owner, 'a', sec(t) + 5 * HOUR);
		runReminders(t);
		expect(mails('rem-owner@hilo.test').length).toBe(0);
		runReminders(at('2026-10-20T12:00:00Z')); // 09:00 in Buenos Aires
		expect(mails('rem-owner@hilo.test').length).toBe(1);
	});

	it('respects the switch and the chosen time of the daily summary', () => {
		setPrefs(ids.owner, { digestEnabled: false, dueSoonEnabled: false });
		const now = at('2026-10-20T09:00:00Z');
		ticket(ids.owner, 'a', sec(now) + 5 * HOUR);
		runReminders(now);
		expect(mails('rem-owner@hilo.test').length).toBe(0);
		setPrefs(ids.owner, { digestEnabled: true, digestTime: 11 * 60, dueSoonEnabled: false });
		runReminders(at('2026-10-20T10:59:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(0);
		runReminders(at('2026-10-20T11:00:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(1);
	});

	it('due-soon alerts only inside working hours and waits for the next window', () => {
		setPrefs(ids.owner, { digestEnabled: false });
		// Due Wednesday 10:00; the 24 h alert time is Tuesday 10:00 (inside hours).
		const due = sec(at('2026-10-21T10:00:00Z'));
		ticket(ids.owner, 'a', due);
		runReminders(at('2026-10-20T09:30:00Z')); // 24h30m before: not in the window yet
		expect(mails('rem-owner@hilo.test').length).toBe(0);
		runReminders(at('2026-10-20T10:00:00Z'));
		const m = mails('rem-owner@hilo.test');
		expect(m.length).toBe(1);
		expect(m[0].subject).toMatch(/Due soon: #\d+ REM a/);
		// Not repeated.
		runReminders(at('2026-10-20T11:00:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(1);
	});

	it('an alert time outside working hours is sent at the start of the next window', () => {
		setPrefs(ids.owner, { digestEnabled: false });
		// Due Tuesday 22:00; the 24 h mark (Monday 22:00) is after hours, so it waits for Tuesday 09:00.
		const due = sec(at('2026-10-20T22:00:00Z'));
		ticket(ids.owner, 'a', due);
		runReminders(at('2026-10-19T22:30:00Z')); // Monday evening: inside the 24 h window, outside hours
		runReminders(at('2026-10-20T07:00:00Z')); // Tuesday before work
		expect(mails('rem-owner@hilo.test').length).toBe(0);
		runReminders(at('2026-10-20T09:00:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(1);
	});

	it('groups several tickets into one due-soon email', () => {
		setPrefs(ids.owner, { digestEnabled: false });
		const now = at('2026-10-20T10:00:00Z');
		for (const n of ['a', 'b', 'c']) ticket(ids.owner, n, sec(now) + 3 * HOUR);
		runReminders(now);
		const m = mails('rem-owner@hilo.test');
		expect(m.length).toBe(1);
		expect(m[0].subject).toBe('Hilo: Due soon: 3 tickets');
	});

	it('does not alert on a ticket whose deadline passed, and re-arms when a new message moves it', () => {
		setPrefs(ids.owner, { digestEnabled: false });
		const now = at('2026-10-20T10:00:00Z');
		const id = ticket(ids.owner, 'a', sec(now) + 2 * HOUR);
		runReminders(now);
		expect(mails('rem-owner@hilo.test').length).toBe(1);
		// A message restarts the clock to a later deadline that is again inside the window.
		db.prepare('UPDATE tickets SET sla_due_at = ? WHERE id = ?').run(sec(now) + 20 * HOUR, id);
		runReminders(at('2026-10-20T12:00:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(2);
		// Overdue tickets get no due-soon alert.
		db.prepare('DELETE FROM email_outbox').run();
		db.prepare('UPDATE tickets SET sla_due_at = ? WHERE id = ?').run(sec(now) - HOUR, id);
		runReminders(at('2026-10-20T13:00:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBe(0);
	});

	it('ignores closed tickets and tickets without a deadline', () => {
		const now = at('2026-10-20T09:00:00Z');
		ticket(ids.owner, 'closed', sec(now) + 2 * HOUR, 'closed');
		ticket(ids.owner, 'nodue', null);
		runReminders(now);
		expect(mails('rem-owner@hilo.test').length).toBe(0);
	});

	it('weekly overdue summary goes out on the chosen weekday, once, and only when something is overdue', () => {
		const tue = at('2026-10-20T09:00:00Z');
		ticket(ids.owner, 'late one', sec(tue) - 30 * HOUR);
		ticket(ids.other, 'other late', sec(tue) - 5 * HOUR);
		runReminders(at('2026-10-19T09:00:00Z')); // Monday: nothing
		expect(mails('rem-owner@hilo.test').filter((m) => /Weekly/.test(m.subject)).length).toBe(0);
		runReminders(tue);
		const w = mails('rem-owner@hilo.test').filter((m) => /Weekly/.test(m.subject));
		expect(w.length).toBe(1);
		expect(w[0].subject).toMatch(/1 overdue ticket/);
		expect(w[0].text_body).toContain('REM late one');
		expect(w[0].text_body).not.toContain('other late');
		runReminders(at('2026-10-20T15:00:00Z'));
		expect(mails('rem-owner@hilo.test').filter((m) => /Weekly/.test(m.subject)).length).toBe(1);
		// Next Tuesday is a new period.
		runReminders(at('2026-10-27T09:00:00Z'));
		expect(mails('rem-owner@hilo.test').filter((m) => /Weekly/.test(m.subject)).length).toBe(2);
		// Another weekday choice.
		setPrefs(ids.other, { overdueWeekday: 4 });
		db.prepare('DELETE FROM email_outbox').run();
		runReminders(at('2026-10-29T09:00:00Z')); // Thursday
		expect(mails('rem-other@hilo.test').filter((m) => /Weekly/.test(m.subject)).length).toBe(1);
	});

	it('does not email disabled accounts', () => {
		db.prepare('UPDATE users SET disabled_at = unixepoch() WHERE id = ?').run(ids.owner);
		const now = at('2026-10-20T09:00:00Z');
		ticket(ids.owner, 'a', sec(now) + 2 * HOUR);
		runReminders(now);
		expect(mails('rem-owner@hilo.test').length).toBe(0);
	});

	it('the test email lists what is due and what is overdue, ignoring the schedule', () => {
		const now = at('2026-10-20T03:00:00Z'); // 03:00: no schedule would fire
		ticket(ids.owner, 'soon', sec(now) + 4 * HOUR);
		ticket(ids.owner, 'late', sec(now) - 4 * HOUR);
		expect(sendTestReminder(ids.owner, now).sent).toBe(true);
		const m = mails('rem-owner@hilo.test');
		expect(m.length).toBe(1);
		expect(m[0].subject).toMatch(/Test of your deadline reminders/);
		expect(m[0].text_body).toContain('REM soon');
		expect(m[0].text_body).toContain('REM late');
		// And it does not consume the real schedule.
		runReminders(at('2026-10-20T09:00:00Z'));
		expect(mails('rem-owner@hilo.test').length).toBeGreaterThan(1);
	});

	it('escapes ticket titles in the HTML body', () => {
		const now = at('2026-10-20T09:00:00Z');
		ticket(ids.owner, '<img src=x onerror=alert(1)>', sec(now) + 2 * HOUR);
		runReminders(now);
		const row = db.prepare(`SELECT html_body FROM email_outbox WHERE to_email = 'rem-owner@hilo.test'`).get() as { html_body: string };
		expect(row.html_body).not.toContain('<img src=x');
		expect(row.html_body).toContain('&lt;img src=x');
	});
});
