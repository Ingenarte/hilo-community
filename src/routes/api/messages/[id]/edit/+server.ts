import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	canAccessTicket,
	editMessage,
	getMessageTicketId,
	getTicket,
	softDeleteMessage
} from '$lib/server/tickets';
import { broadcast } from '$lib/server/sse';

function authorise(messageId: number, locals: App.Locals) {
	if (!locals.user) throw error(401, 'Unauthorized');
	const ticketId = getMessageTicketId(messageId);
	if (!ticketId) throw error(404, 'Message not found');
	const t = getTicket(ticketId);
	if (!t) throw error(404, 'Ticket not found');
	if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');
	// Closed tickets are frozen for users: only an administrator may still change messages.
	if (t.status === 'closed' && locals.user.role !== 'admin') {
		throw error(409, 'This ticket is closed, so its messages can no longer be changed.');
	}
	return { ticketId };
}

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const messageId = Number(params.id);
	if (!Number.isFinite(messageId)) throw error(404, 'Not found');
	const { ticketId } = authorise(messageId, locals);
	const data = (await request.json().catch(() => ({}))) as { body?: string };
	const body = (data.body ?? '').trim();
	if (!body) return json({ error: 'Body required' }, { status: 400 });
	const ok = editMessage({
		messageId,
		body,
		by: { id: locals.user!.id, role: locals.user!.role }
	});
	if (!ok) return json({ error: 'Edit refused' }, { status: 403 });
	broadcast(ticketId, 'edit', { message_id: messageId });
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const messageId = Number(params.id);
	if (!Number.isFinite(messageId)) throw error(404, 'Not found');
	const { ticketId } = authorise(messageId, locals);
	const ok = softDeleteMessage({
		messageId,
		by: { id: locals.user!.id, role: locals.user!.role }
	});
	if (!ok) return json({ error: 'Delete refused' }, { status: 403 });
	broadcast(ticketId, 'delete', { message_id: messageId });
	return json({ ok: true });
};
