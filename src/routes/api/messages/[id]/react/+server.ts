import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessTicket, getMessageTicketId, getTicket, toggleReaction } from '$lib/server/tickets';
import { broadcast } from '$lib/server/sse';

const ALLOWED_EMOJI = ['👍', '❤️', '😄', '🎉', '🙏', '👀', '✅', '🚀'];

/**
 * POST /api/messages/:id/react  { emoji }
 * Toggle the reaction by the current user (re-posting the same emoji removes
 * it). Constrained to the allow-list so the DB doesn't accumulate garbage.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const messageId = Number(params.id);
	if (!Number.isFinite(messageId)) throw error(404, 'Not found');

	const ticketId = getMessageTicketId(messageId);
	if (!ticketId) throw error(404, 'Message not found');
	const t = getTicket(ticketId);
	if (!t) throw error(404, 'Ticket not found');
	if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');

	const data = (await request.json().catch(() => ({}))) as { emoji?: string };
	const emoji = (data.emoji || '').trim();
	if (!ALLOWED_EMOJI.includes(emoji))
		return json({ error: 'Emoji not allowed' }, { status: 400 });

	const action = toggleReaction(messageId, locals.user.id, emoji);
	broadcast(ticketId, 'reaction', { message_id: messageId, emoji, action });

	return json({ ok: true, action });
};
