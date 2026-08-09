import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { setTicketPriority, setTicketStatus, setTicketArchived } from '$lib/server/tickets';
import { PRIORITIES, type TicketPriority, type TicketStatus } from '$lib/server/db';

type BulkBody = {
	ids: number[];
	op: 'close' | 'reopen' | 'priority' | 'archive' | 'unarchive';
	priority?: TicketPriority;
};

const ALLOWED_STATUS: Record<string, TicketStatus> = {
	close: 'closed',
	reopen: 'open'
};

/**
 * POST /api/admin/tickets/bulk
 * Body: { ids: number[], op: 'close'|'reopen'|'priority', priority?: TicketPriority }
 * Returns: { ok: true, affected: number }
 *
 * Admin-only. Validates IDs exist and short-circuits empty payloads.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const ctype = (request.headers.get('content-type') || '').toLowerCase();
	if (!ctype.startsWith('application/json'))
		return json({ error: 'Content-Type must be application/json' }, { status: 415 });

	const raw = (await request.json().catch(() => null)) as BulkBody | null;
	if (!raw || !Array.isArray(raw.ids) || raw.ids.length === 0)
		return json({ error: 'ids[] is required' }, { status: 400 });
	if (raw.ids.length > 500)
		return json({ error: 'too many ids (max 500)' }, { status: 400 });

	const ids = raw.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
	if (ids.length === 0) return json({ error: 'no valid ids' }, { status: 400 });

	let affected = 0;
	const apply = db.transaction((fn: () => void) => fn());

	if (raw.op === 'close' || raw.op === 'reopen') {
		const target = ALLOWED_STATUS[raw.op];
		apply(() => {
			for (const id of ids) {
				setTicketStatus(id, target);
				affected += 1;
			}
		});
	} else if (raw.op === 'priority') {
		if (!raw.priority || !PRIORITIES.includes(raw.priority))
			return json({ error: 'invalid priority' }, { status: 400 });
		apply(() => {
			for (const id of ids) {
				setTicketPriority(id, raw.priority as TicketPriority);
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
	} else {
		return json({ error: 'unknown op' }, { status: 400 });
	}

	return json({ ok: true, affected });
};
