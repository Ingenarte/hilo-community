/**
 * Per-user, per-kind email throttle helper.
 *
 * Reads and writes the `email_throttle` table to enforce a one-email-per-
 * calendar-day cap for a given notification kind. The calendar day is scoped
 * to the user's chosen timezone (UTC for 'immediate'-schedule users).
 *
 * Only `sendMessageNotification` calls this module. Other email senders
 * (task notifications, welcome emails, magic-link / password-change emails)
 * are deliberately kept unthrottled.
 */

import { db } from './db';
import { timezoneFor, epochForWallClockInTz } from './schedule';

export type ThrottleKind = 'message-unread';

/**
 * Returns the unix epoch (seconds) of the most recent send for this
 * (user, kind), or null if none exists.
 */
export function getLastSentEpoch(userId: number, kind: ThrottleKind): number | null {
	const row = db
		.prepare('SELECT last_sent_at FROM email_throttle WHERE user_id = ? AND kind = ?')
		.get(userId, kind) as { last_sent_at: number } | undefined;
	return row?.last_sent_at ?? null;
}

/**
 * Returns the unix epoch (seconds) at which the current calendar day started
 * in the user's chosen timezone. For 'immediate' users (no tz), UTC is used.
 * The day boundary is local 00:00:00.
 */
export function getDayStartEpoch(scheduleKey: string, now: Date = new Date()): number {
	const tz = timezoneFor(scheduleKey);
	if (!tz) {
		// UTC fallback for 'immediate' users.
		const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		return Math.floor(d.getTime() / 1000);
	}
	// Determine the current local date in the user's timezone.
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(now);
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
	const year = get('year');
	const month = get('month');
	const day = get('day');
	// Convert local midnight back to a UTC epoch, correcting for DST via
	// the two-round-trip helper already present in schedule.ts.
	return epochForWallClockInTz(tz, year, month, day, 0, 0);
}

/**
 * Returns true if the user has NOT yet received an email for this kind today
 * (in their local timezone). Convenience wrapper around getLastSentEpoch and
 * getDayStartEpoch.
 */
export function canSendToday(userId: number, kind: ThrottleKind, scheduleKey: string): boolean {
	const last = getLastSentEpoch(userId, kind);
	if (last == null) return true;
	return last < getDayStartEpoch(scheduleKey);
}

/**
 * Stamps the (user, kind) row with the current time (or a provided epoch).
 * Uses an UPSERT so the call is idempotent and never leaves a stale row.
 */
export function markSent(userId: number, kind: ThrottleKind, when?: number): void {
	const epoch = when ?? Math.floor(Date.now() / 1000);
	db.prepare(
		`INSERT INTO email_throttle (user_id, kind, last_sent_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, kind) DO UPDATE SET last_sent_at = excluded.last_sent_at`
	).run(userId, kind, epoch);
}
