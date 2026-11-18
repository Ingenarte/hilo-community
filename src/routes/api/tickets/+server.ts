import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TicketCreateError, openTicket } from '$lib/server/ticketCreate';

/**
 * POST /api/tickets
 * JSON body: { title, body, priority?, priorityReason?, confirmUrgent?, projectId?, newProjectName? }
 *
 * Validation and creation live in `openTicket` (shared with POST /api/v1/tickets):
 *  - `priority` is urgent|high|normal|low (default normal) and sets the response
 *    target (24/48/72/96 h). Urgent also needs `priorityReason` (>= 10 chars) and
 *    `confirmUrgent: true`.
 *  - A ticket MUST be associated with a project. No project: 400.
 *  - `projectId`: an active project the user is assigned to (admins bypass).
 *  - `newProjectName`: admins create an active project; for users it is
 *    created as 'pending' until an admin approves, renames or merges it.
 *  - Tickets opened by users start as awaiting approval (admin decides).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	try {
		const created = openTicket(locals.user, body);
		return json({ ok: true, ticketId: created.ticketId });
	} catch (err) {
		if (err instanceof TicketCreateError) throw error(err.status, err.message);
		throw err;
	}
};
