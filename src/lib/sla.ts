// Response-time targets per ticket priority. Shared by server and client:
// keep this module free of server-only imports.

export type Priority = 'urgent' | 'high' | 'normal' | 'low';

export const SLA_HOURS: Record<Priority, number> = {
	urgent: 24,
	high: 48,
	normal: 72,
	low: 96
};

export const PRIORITY_LABEL: Record<Priority, string> = {
	urgent: 'Urgent',
	high: 'High',
	normal: 'Normal',
	low: 'Low'
};

export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'normal', 'low'];
export const DEFAULT_PRIORITY: Priority = 'normal';

export const URGENT_REASON_MIN = 10;
export const URGENT_REASON_MAX = 500;

export function isPriority(v: unknown): v is Priority {
	return typeof v === 'string' && (PRIORITY_ORDER as string[]).includes(v);
}

export function slaSeconds(p: Priority): number {
	return SLA_HOURS[p] * 3600;
}

export function slaDueAt(createdAtSec: number, p: Priority): number {
	return createdAtSec + slaSeconds(p);
}

export type UrgentCheck = { ok: true; reason: string } | { ok: false; error: string };

/**
 * Urgent is the only level that needs a justification plus an explicit
 * confirmation. Every server entry point that can set it must call this,
 * because UI-side checks are trivially bypassed.
 */
export function checkUrgentRequest(reasonRaw: unknown, confirmRaw: unknown): UrgentCheck {
	const confirmed = confirmRaw === true || confirmRaw === '1' || confirmRaw === 'true';
	if (!confirmed) return { ok: false, error: 'Please confirm that this ticket is urgent.' };
	const reason = String(reasonRaw ?? '').trim();
	if (reason.length < URGENT_REASON_MIN) {
		return {
			ok: false,
			error: `Explain why this is urgent (at least ${URGENT_REASON_MIN} characters).`
		};
	}
	if (reason.length > URGENT_REASON_MAX) {
		return { ok: false, error: `The reason is too long (max ${URGENT_REASON_MAX} characters).` };
	}
	return { ok: true, reason };
}

/** Extra hours a ticket can be given, and the written reason that must come with it. */
export const EXTEND_HOUR_CHOICES = [24, 48, 72] as const;
export const EXTEND_REASON_MIN = 10;
export const EXTEND_REASON_MAX = 500;

export type ExtendCheck = { ok: true; hours: number; reason: string } | { ok: false; error: string };

/** Every server entry point that extends a deadline must call this; UI checks are easy to bypass. */
export function checkExtendRequest(hoursRaw: unknown, reasonRaw: unknown): ExtendCheck {
	const hours = Number(hoursRaw);
	if (!(EXTEND_HOUR_CHOICES as readonly number[]).includes(hours)) {
		return { ok: false, error: 'Choose how much time to add.' };
	}
	const reason = String(reasonRaw ?? '').trim();
	if (reason.length < EXTEND_REASON_MIN) {
		return {
			ok: false,
			error: `Explain why more time is needed (at least ${EXTEND_REASON_MIN} characters).`
		};
	}
	if (reason.length > EXTEND_REASON_MAX) {
		return { ok: false, error: `The reason is too long (max ${EXTEND_REASON_MAX} characters).` };
	}
	return { ok: true, hours, reason };
}

export type SlaTone = 'none' | 'ok' | 'warn' | 'critical' | 'overdue';

export function remainingSeconds(dueAt: number | null | undefined, nowSec: number): number | null {
	return dueAt == null ? null : dueAt - nowSec;
}

/** "2d 5h", "5h 12m", "12m", "<1m". Takes a non-negative number of seconds. */
export function formatDuration(totalSec: number): string {
	const s = Math.max(0, Math.floor(totalSec));
	const days = Math.floor(s / 86400);
	const hours = Math.floor((s % 86400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	if (days >= 1) return `${days}d ${hours}h`;
	if (hours >= 1) return `${hours}h ${minutes}m`;
	if (minutes >= 1) return `${minutes}m`;
	return '<1m';
}

export function formatRemaining(dueAt: number | null | undefined, nowSec: number): string {
	const rem = remainingSeconds(dueAt, nowSec);
	if (rem === null) return 'No deadline';
	if (rem <= 0) return `Overdue ${formatDuration(-rem)}`;
	return `${formatDuration(rem)} left`;
}

export function slaTone(
	dueAt: number | null | undefined,
	priority: Priority,
	nowSec: number
): SlaTone {
	const rem = remainingSeconds(dueAt, nowSec);
	if (rem === null) return 'none';
	if (rem <= 0) return 'overdue';
	const ratio = rem / slaSeconds(priority);
	if (ratio < 0.25) return 'critical';
	if (ratio < 0.5) return 'warn';
	return 'ok';
}
