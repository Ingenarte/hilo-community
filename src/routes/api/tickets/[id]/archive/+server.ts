import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTicket, setTicketArchived } from '$lib/server/tickets';

/**
 * POST /api/tickets/:id/archive  { archived: boolean }
 * Admin only. Soft-archives the ticket (filtered out of the default inbox)
 * without deleting any data.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Ticket not found');
	const t = getTicket(id);
	if (!t) throw error(404, 'Ticket not found');

	const data = (await request.json().catch(() => ({}))) as { archived?: boolean };
	setTicketArchived(id, !!data.archived);
	return json({ ok: true, archived: !!data.archived });
};
