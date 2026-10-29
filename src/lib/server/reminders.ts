import { db } from './db';
import { config } from './env';
import { log } from './logger';
import { parseInTz } from './schedule';
import { queryTickets, type TicketRow } from './tickets';
import { getReminderPrefs } from './reminderPrefs';
import { isWorkDay } from '$lib/reminderRules';
import { PRIORITY_LABEL, formatDuration, isPriority } from '$lib/sla';

/**
 * Deadline reminders. Three independent emails per person, each with its own
 * switch and schedule (Preferences, local time zone of the person):
 *   - due soon:   tickets whose response target ends within N hours (24 by
 *                 default), sent inside working hours; a ticket whose alert
 *                 time falls outside them waits for the next working window.
 *   - digest:     one daily email on working days with everything due in the
 *                 next 24 hours. It also marks those tickets as alerted, so
 *                 the due-soon email does not repeat them.
 *   - overdue:    one weekly email (Tuesday by default) with the overdue tickets.
 * Each person only sees the tickets they can see in the inbox. `reminder_log`
 * makes every send idempotent across restarts and overlapping runs.
 */

type UserRow = { id: number; email: string; role: 'user' | 'admin' };
type Kind = 'due-soon' | 'digest' | 'overdue-weekly';

const MAX_LISTED = 30;
const DAY = 86400;

const base = () => config.publicBaseUrl.replace(/\/+$/, '');
const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── data ─────────────────────────────────────────────────────────────────────

function visibleOpen(user: UserRow, extra: Parameters<typeof queryTickets>[0]) {
	const admin = user.role === 'admin';
	return queryTickets({
		userId: admin ? undefined : user.id,
		userEmail: admin ? undefined : user.email,
		status: 'open',
		sort: 'due',
		limit: 100,
		...extra
	});
}

function wasSent(userId: number, kind: Kind, period: string, ticketId = 0): boolean {
	return !!db
		.prepare('SELECT 1 FROM reminder_log WHERE user_id = ? AND kind = ? AND period_key = ? AND ticket_id = ?')
		.get(userId, kind, period, ticketId);
}

function record(userId: number, kind: Kind, period: string, count: number, ticketId = 0): void {
	db.prepare(
		'INSERT OR IGNORE INTO reminder_log (user_id, kind, period_key, ticket_id, item_count) VALUES (?, ?, ?, ?, ?)'
	).run(userId, kind, period, ticketId, count);
}

// ── email ────────────────────────────────────────────────────────────────────

function whenText(t: TicketRow, nowSec: number, tz: string): string {
	const due = t.sla_due_at as number;
	const local = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(new Date(due * 1000));
	const rel = due > nowSec ? `in ${formatDuration(due - nowSec)}` : `${formatDuration(nowSec - due)} overdue`;
	return `${local} (${rel})`;
}

type Section = { heading: string; tickets: TicketRow[]; total: number; overdue: boolean };

function renderEmail(
	intro: string,
	sections: Section[],
	nowSec: number,
	tz: string
): { text: string; html: string } {
	const brand = config.brand;
	const queueUrl = `${base()}/queue`;
	const prefsUrl = `${base()}/preferences#reminders`;
	const textParts: string[] = ['Hi,', '', intro, ''];
	const htmlParts: string[] = [`<p>Hi,</p><p>${esc(intro)}</p>`];

	for (const s of sections) {
		textParts.push(`${s.heading} (${s.total})`);
		htmlParts.push(`<h3 style="margin:18px 0 6px;font-size:15px;">${esc(s.heading)} (${s.total})</h3>`);
		htmlParts.push('<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">');
		for (const t of s.tickets.slice(0, MAX_LISTED)) {
			const url = `${base()}/tickets/${t.id}`;
			const prio = isPriority(t.priority) ? PRIORITY_LABEL[t.priority] : t.priority;
			const proj = t.projects.length ? ` · ${t.projects.join(', ')}` : '';
			const when = whenText(t, nowSec, tz);
			textParts.push(`  #${t.id} ${t.title} [${prio}] ${when}${proj}`, `  ${url}`);
			htmlParts.push(
				`<tr><td style="padding:8px 0;border-top:1px solid #e4e4e7;">` +
					`<a href="${esc(url)}" style="color:#18181b;font-weight:600;text-decoration:none;">#${t.id} ${esc(t.title)}</a>` +
					`<div style="color:${s.overdue ? '#b91c1c' : '#52525b'};font-size:13px;">${esc(prio)} · ${esc(when)}${esc(proj)}</div>` +
					`</td></tr>`
			);
		}
		htmlParts.push('</table>');
		if (s.total > MAX_LISTED) {
			const more = `and ${s.total - MAX_LISTED} more: see the queue.`;
			textParts.push(`  ${more}`);
			htmlParts.push(`<p style="color:#52525b;font-size:13px;">${esc(more)}</p>`);
		}
		textParts.push('');
	}

	textParts.push(`Open the queue: ${queueUrl}`, '', `Change or switch off these emails: ${prefsUrl}`, '', brand);
	htmlParts.push(
		`<p style="margin:20px 0;"><a href="${esc(queueUrl)}" style="background:#6d4aff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;">Open the queue</a></p>` +
			`<p style="color:#71717a;font-size:12px;">You get this because deadline reminders are on in your preferences. ` +
			`<a href="${esc(prefsUrl)}" style="color:#71717a;">Change or switch them off</a>.</p>`
	);
	const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;max-width:600px;margin:0 auto;padding:24px;">${htmlParts.join('')}<p style="color:#71717a;margin-top:28px;">${esc(brand)}</p></body></html>`;
	return { text: textParts.join('\n'), html };
}

function enqueue(user: UserRow, subject: string, body: { text: string; html: string }): void {
	db.prepare(
		`INSERT INTO email_outbox (user_id, to_email, subject, text_body, html_body, send_after)
		 VALUES (?, ?, ?, ?, ?, unixepoch())`
	).run(user.id, user.email, `${config.brand}: ${subject}`, body.text, body.html);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── per person ───────────────────────────────────────────────────────────────

function processUser(user: UserRow, now: Date, nowSec: number): number {
	const p = getReminderPrefs(user.id);
	const tz = p.effectiveTz;
	let parts;
	try {
		parts = parseInTz(now, tz);
	} catch {
		parts = parseInTz(now, 'UTC');
	}
	const minutes = parts.hour * 60 + parts.minute;
	const localDate = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
	let sent = 0;

	// 1) Weekly overdue summary.
	if (
		p.overdueEnabled &&
		parts.weekday === p.overdueWeekday &&
		minutes >= p.overdueTime &&
		!wasSent(user.id, 'overdue-weekly', localDate)
	) {
		const page = visibleOpen(user, { overdueAt: nowSec });
		db.transaction(() => {
			if (page.total > 0) {
				const mail = renderEmail(
					'These tickets passed their response time and are still open.',
					[{ heading: 'Overdue tickets', tickets: page.tickets, total: page.total, overdue: true }],
					nowSec,
					tz
				);
				enqueue(user, `Weekly summary: ${plural(page.total, 'overdue ticket', 'overdue tickets')}`, mail);
				sent += 1;
			}
			record(user.id, 'overdue-weekly', localDate, page.total);
		})();
	}

	// 2) Daily digest of everything due in the next 24 hours (working days only,
	//    not after working hours, so a late server start does not send it at night).
	if (
		p.digestEnabled &&
		isWorkDay(p.workDays, parts.weekday) &&
		minutes >= p.digestTime &&
		minutes < p.workEnd &&
		!wasSent(user.id, 'digest', localDate)
	) {
		const page = visibleOpen(user, { dueAfter: nowSec, dueUntil: nowSec + DAY });
		db.transaction(() => {
			if (page.total > 0) {
				const mail = renderEmail(
					'These tickets reach their response time within the next 24 hours.',
					[{ heading: 'Due in the next 24 hours', tickets: page.tickets, total: page.total, overdue: false }],
					nowSec,
					tz
				);
				enqueue(
					user,
					`Daily summary: ${plural(page.total, 'ticket', 'tickets')} due in the next 24 hours`,
					mail
				);
				sent += 1;
				// The digest already warned about these: no separate due-soon email.
				for (const t of page.tickets) record(user.id, 'due-soon', String(t.sla_due_at), 1, t.id);
			}
			record(user.id, 'digest', localDate, page.total);
		})();
	}

	// 3) Due-soon alert, only inside working hours.
	const inHours =
		isWorkDay(p.workDays, parts.weekday) && minutes >= p.workStart && minutes < p.workEnd;
	if (p.dueSoonEnabled && inHours) {
		const page = visibleOpen(user, { dueAfter: nowSec, dueUntil: nowSec + p.dueSoonHours * 3600 });
		const fresh = page.tickets.filter((t) => !wasSent(user.id, 'due-soon', String(t.sla_due_at), t.id));
		if (fresh.length > 0) {
			db.transaction(() => {
				const mail = renderEmail(
					`These tickets reach their response time within ${p.dueSoonHours} hours.`,
					[{ heading: `Due within ${p.dueSoonHours} hours`, tickets: fresh, total: fresh.length, overdue: false }],
					nowSec,
					tz
				);
				const subject =
					fresh.length === 1
						? `Due soon: #${fresh[0].id} ${fresh[0].title.slice(0, 60)}`
						: `Due soon: ${fresh.length} tickets`;
				enqueue(user, subject, mail);
				for (const t of fresh) record(user.id, 'due-soon', String(t.sla_due_at), 1, t.id);
			})();
			sent += 1;
		}
	}
	return sent;
}

/** One pass over every active account. Safe to call as often as you like. */
export function runReminders(now: Date = new Date()): { sent: number } {
	const nowSec = Math.floor(now.getTime() / 1000);
	const users = db
		.prepare('SELECT id, email, role FROM users WHERE disabled_at IS NULL')
		.all() as UserRow[];
	let sent = 0;
	for (const u of users) {
		try {
			sent += processUser(u, now, nowSec);
		} catch (err) {
			log.error('reminders failed for a user', {
				user_id: u.id,
				err: err instanceof Error ? err.message : String(err)
			});
		}
	}
	// Keep the log small: nothing older than 60 days is needed for de-duplication.
	db.prepare('DELETE FROM reminder_log WHERE sent_at < ?').run(nowSec - 60 * DAY);
	if (sent > 0) log.info('reminder emails queued', { count: sent });
	return { sent };
}

/** The "send me a test email" button: both lists, right now, ignoring schedule and log. */
export function sendTestReminder(userId: number, now: Date = new Date()): { sent: boolean } {
	const user = db.prepare('SELECT id, email, role FROM users WHERE id = ? AND disabled_at IS NULL').get(userId) as
		| UserRow
		| undefined;
	if (!user) return { sent: false };
	const nowSec = Math.floor(now.getTime() / 1000);
	const tz = getReminderPrefs(userId).effectiveTz;
	const soon = visibleOpen(user, { dueAfter: nowSec, dueUntil: nowSec + DAY });
	const late = visibleOpen(user, { overdueAt: nowSec });
	const sections: Section[] = [
		{ heading: 'Due in the next 24 hours', tickets: soon.tickets, total: soon.total, overdue: false },
		{ heading: 'Overdue tickets', tickets: late.tickets, total: late.total, overdue: true }
	];
	const empty = soon.total === 0 && late.total === 0;
	const mail = renderEmail(
		empty
			? 'This is a test of your deadline reminders. No ticket is due soon or overdue right now.'
			: 'This is a test of your deadline reminders, with what is due or overdue right now.',
		sections.filter((s) => s.total > 0),
		nowSec,
		tz
	);
	enqueue(user, 'Test of your deadline reminders', mail);
	return { sent: true };
}

// ── worker ───────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Starts the periodic pass. REMINDERS_ENABLED=0 switches the feature off. */
export function startReminderWorker(): void {
	if (started || process.env.REMINDERS_ENABLED === '0') return;
	started = true;
	const pollMs = Math.max(30_000, Number(process.env.REMINDERS_POLL_MS) || 5 * 60_000);
	const tick = () => {
		try {
			runReminders();
		} catch (err) {
			log.error('reminder pass failed', { err: err instanceof Error ? err.message : String(err) });
		} finally {
			timer = setTimeout(tick, pollMs);
		}
	};
	timer = setTimeout(tick, 60_000);
	log.info('reminder worker started', { poll_ms: pollMs });
}

export function stopReminderWorker(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	started = false;
}
