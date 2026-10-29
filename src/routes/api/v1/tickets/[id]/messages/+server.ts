import type { RequestHandler } from './$types';
import { config } from '$lib/server/env';
import { audit } from '$lib/server/audit';
import { appendMessage } from '$lib/server/tickets';
import { TICKET_CLOSED_MESSAGE } from '$lib/server/tickets-messages';
import { broadcast } from '$lib/server/sse';
import { dispatchWebhooks } from '$lib/server/webhooks';
import { fanOutMessageNotification } from '$lib/server/notify';
import { limited, loadScopedTicket, requireAuth, v1Error, v1Json } from '$lib/server/apiV1';

/** Agent replies are meant to be short. */
const MAX_AGENT_REPLY_CHARS = 2000;

/**
 * POST /api/v1/tickets/:id/messages  { "body": "short reply" }
 * Needs a token with reply permission. The message is posted as the token's
 * user, flagged as written by an agent, and notifies the ticket's participants
 * exactly like a normal reply. Internal notes are not available to agents.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const auth = requireAuth(locals);
	if (auth instanceof Response) return auth;
	if (!auth.token.canReply) return v1Error(403, 'This token is read-only');

	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return v1Error(415, 'Content-Type must be application/json');
	}
	const payload = (await request.json().catch(() => null)) as
		| { body?: unknown; internal?: unknown }
		| null;
	if (!payload || typeof payload.body !== 'string') return v1Error(400, 'body (string) is required');
	if (payload.internal) return v1Error(400, 'Agents cannot post internal notes');
	const body = payload.body.trim();
	if (!body) return v1Error(400, 'body must not be empty');
	if (body.length > MAX_AGENT_REPLY_CHARS) {
		return v1Error(400, `Keep the reply short: at most ${MAX_AGENT_REPLY_CHARS} characters`);
	}

	// Rate limit after payload validation so malformed requests do not burn the
	// quota, but before the scope check so ticket ids cannot be probed freely.
	const rlMinute = limited(auth.token, 'reply-minute', 3, 60);
	if (rlMinute) return rlMinute;
	const rlHour = limited(auth.token, 'reply-hour', 20, 3600);
	if (rlHour) return rlHour;

	const loaded = loadScopedTicket(auth, params.id);
	if (!loaded.ok) return loaded.response;
	const { ticket: t, id } = loaded;
	if (t.status === 'closed' && auth.user.role !== 'admin') {
		return v1Error(409, TICKET_CLOSED_MESSAGE);
	}

	const messageId = appendMessage({
		ticketId: id,
		senderId: auth.user.id,
		senderRole: auth.user.role,
		body,
		internal: false,
		viaTokenId: auth.token.id
	});
	broadcast(id, 'message', { id: messageId });

	fanOutMessageNotification({
		ticketId: id,
		ticketTitle: t.title,
		authorEmail: auth.user.email,
		authorRole: auth.user.role,
		body,
		attachments: [],
		sseKind: 'message',
		fallbackPreview: '(new message)'
	}).catch((err) => console.error('[notify] fan-out failed', err));

	dispatchWebhooks('ticket.reply', {
		ticket_id: id,
		title: t.title,
		priority: t.priority,
		status: t.status,
		author: auth.user.email,
		preview: body,
		url: `${config.publicBaseUrl.replace(/\/$/, '')}/tickets/${id}`,
		brand: config.brand
	});

	audit('ticket.agent_reply', {
		actor: auth.user,
		target: `ticket:${id}`,
		detail: { token_id: auth.token.id, length: body.length }
	});
	return v1Json({ ok: true, id: messageId }, { status: 201 });
};
