import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessTicket, getTicket } from '$lib/server/tickets';
import { broadcast } from '$lib/server/sse';

/**
 * POST /api/messages/:id/typing
 * Notifies any active SSE subscribers that someone (the caller) is typing.
 * Fire-and-forget — no body, no rate limit beyond the natural client throttle.
 */
export const POST: RequestHandler = ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');
	const t = getTicket(id);
	if (!t) throw error(404, 'Not found');
	if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');
	broadcast(id, 'typing', {
		userId: locals.user.id,
		role: locals.user.role,
		email: locals.user.email,
		at: Date.now()
	});
	return json({ ok: true });
};
