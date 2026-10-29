import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import {
	extendTicketTime,
	setTicketPriority,
	setTicketStatus,
	setTicketArchived
} from '$lib/server/tickets';
import { audit } from '$lib/server/audit';
import { broadcast } from '$lib/server/sse';
import { assertSameOriginJson } from '$lib/server/csrf';
import { rateLimit } from '$lib/server/rateLimit';
import { checkExtendRequest, checkUrgentRequest } from '$lib/sla';
import { PRIORITIES, type TicketPriority, type TicketStatus } from '$lib/server/db';

type BulkBody = {
	ids: number[];
	op: 'close' | 'reopen' | 'priority' | 'archive' | 'unarchive' | 'extend';
	priority?: TicketPriority;
	/** extend only: hours to add (24, 48 or 72). The written `reason` is mandatory. */
	hours?: number;
	/** Urgent only: justification + explicit confirmation, applied to every selected ticket. */
	reason?: string;
	confirmUrgent?: boolean | string;
};

const ALLOWED_STATUS: Record<string, TicketStatus> = {
	close: 'closed',
	reopen: 'open'
};

/**
 * POST /api/admin/tickets/bulk
 * Body: { ids: number[], op: 'close'|'reopen'|'priority'|'archive'|'unarchive'|'extend', priority?, hours?, reason? }
 * Returns: { ok: true, affected: number, skipped?: number }  (skipped: tickets an extension could not apply to)
 *
 * Admin-only. Validates IDs exist and short-circuits empty payloads.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const ctype = (request.headers.get('content-type') || '').toLowerCase();
	if (!ctype.startsWith('application/json'))
		return json({ error: 'Content-Type must be application/json' }, { status: 415 });
	assertSameOriginJson(request, url);
	const rl = rateLimit(`admin-bulk:user:${locals.user.id}`, 30, 60);
	if (!rl.ok) return json({ error: 'Too many bulk actions, try again shortly.' }, { status: 429 });

	const raw = (await request.json().catch(() => null)) as BulkBody | null;
	if (!raw || !Array.isArray(raw.ids) || raw.ids.length === 0)
		return json({ error: 'ids[] is required' }, { status: 400 });
	if (raw.ids.length > 500)
		return json({ error: 'too many ids (max 500)' }, { status: 400 });

	const ids = raw.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
	if (ids.length === 0) return json({ error: 'no valid ids' }, { status: 400 });

	let affected = 0;
	let skipped = 0;
	let auditDetail: Record<string, unknown> = {};
	const apply = db.transaction((fn: () => void) => fn());

	if (raw.op === 'close' || raw.op === 'reopen') {
		const target = ALLOWED_STATUS[raw.op];
		apply(() => {
			for (const id of ids) {
				setTicketStatus(id, target);
				affected += 1;
				broadcast(id, 'edit', { id });
			}
		});
	} else if (raw.op === 'priority') {
		if (!raw.priority || !PRIORITIES.includes(raw.priority))
			return json({ error: 'invalid priority' }, { status: 400 });
		let reason: string | null = null;
		if (raw.priority === 'urgent') {
			const check = checkUrgentRequest(raw.reason, raw.confirmUrgent);
			if (!check.ok) return json({ error: check.error }, { status: 400 });
			reason = check.reason;
		}
		apply(() => {
			for (const id of ids) {
				setTicketPriority(id, raw.priority as TicketPriority, reason);
				affected += 1;
			}
		});
	} else if (raw.op === 'archive' || raw.op === 'unarchive') {
		const target = raw.op === 'archive';
		apply(() => {
			for (const id of ids) {
				setTicketArchived(id, target);
				affected += 1;
			}
		});
	} else if (raw.op === 'extend') {
		// Same rule as extending one ticket: a written reason is mandatory.
		const check = checkExtendRequest(raw.hours, raw.reason);
		if (!check.ok) return json({ error: check.error }, { status: 400 });
		auditDetail = { hours: check.hours, reason: check.reason };
		apply(() => {
			for (const id of ids) {
				const r = extendTicketTime(id, locals.user!.id, check.hours, check.reason);
				if (r) {
					affected += 1;
					audit('ticket.time_extended', {
						actor: locals.user,
						target: `ticket:${id}`,
						detail: { hours: check.hours, reason: check.reason, previous_due: r.previousDue, new_due: r.newDue, bulk: true }
					});
				} else skipped += 1;
			}
		});
	} else {
		return json({ error: 'unknown op' }, { status: 400 });
	}

	audit(`tickets.bulk_${raw.op}`, {
		actor: locals.user,
		target: null,
		detail: { count: ids.length, affected, skipped, ids: ids.slice(0, 100), priority: raw.priority, ...auditDetail }
	});
	return json({ ok: true, affected, skipped });
};
