import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessTicket, getTicket } from '$lib/server/tickets';
import { markTicketRead } from '$lib/server/reads';
import { broadcast } from '$lib/server/sse';
import { db } from '$lib/server/db';

/**
 * POST /api/tickets/[id]/read
 *   Marks the ticket fully read up to its latest message for the
 *   current user. Idempotent. Used as a manual fallback (e.g. "mark
 *   all as read" gestures) and by the client when it knows about new
 *   messages arriving while the detail view is already open.
 */
export const POST: RequestHandler = ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'invalid id');
	const ticket = getTicket(id);
	if (!ticket) throw error(404, 'Ticket not found');
	if (!canAccessTicket(locals.user, ticket)) throw error(403, 'Forbidden');

	const latest = db
		.prepare(
			`SELECT id, created_at FROM messages
			 WHERE ticket_id = ? AND deleted_at IS NULL
			 ORDER BY created_at DESC, id DESC LIMIT 1`
		)
		.get(id) as { id: number; created_at: number } | undefined;
	let lastReadAt: number;
	if (latest) {
		markTicketRead(id, locals.user.id, latest.id, latest.created_at);
		lastReadAt = latest.created_at;
	} else {
		lastReadAt = Math.floor(Date.now() / 1000);
		markTicketRead(id, locals.user.id, null, lastReadAt);
	}

	// Tell every other tab watching this ticket that someone moved
	// their read pointer, so the message author's bubbles can render
	// "Read by …" receipts without waiting for a manual reload.
	broadcast(id, 'read', {
		user_id: locals.user.id,
		last_read_at: lastReadAt
	});

	return json({ ok: true });
};
