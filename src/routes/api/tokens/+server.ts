import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import {
	MAX_ACTIVE_TOKENS,
	countActiveApiTokens,
	createApiToken,
	listApiTokens
} from '$lib/server/apiTokens';
import { rateLimit } from '$lib/server/rateLimit';
import { canAccessTicket, getTicket } from '$lib/server/tickets';

/**
 * Token management. Browser session only: the hook rejects bearer tokens on
 * every path outside /api/v1/*, so a token can never mint or list tokens.
 *
 * GET  /api/tokens  -> my active tokens (never the secret)
 * POST /api/tokens  { ticketId?: number, canReply?: boolean, name?: string }
 *   Creates a token that expires in 96 hours. The secret is returned once.
 */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	return json({ tokens: listApiTokens(locals.user.id) }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	// CSRF: a JSON content type forces a CORS preflight, so a cross-site
	// "simple" request (text/plain, no-cors) cannot mint a token for the
	// victim's session. The Origin check is defence in depth.
	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().startsWith('application/json')) {
		throw error(415, 'Content-Type must be application/json');
	}
	const origin = request.headers.get('origin');
	if (origin !== null && origin !== url.origin) throw error(403, 'Cross-origin request blocked');

	const rl = rateLimit(`token-create:user:${locals.user.id}`, 10, 3600);
	if (!rl.ok) throw error(429, 'Too many tokens created, try again later.');

	const body = (await request.json().catch(() => ({}))) as {
		ticketId?: unknown;
		canReply?: unknown;
		name?: unknown;
	};

	let ticketId: number | null = null;
	if (body.ticketId !== undefined && body.ticketId !== null) {
		const id = Number(body.ticketId);
		if (!Number.isInteger(id) || id <= 0) throw error(400, 'ticketId must be a ticket id');
		const t = getTicket(id);
		if (!t || !canAccessTicket(locals.user, t)) throw error(404, 'Ticket not found');
		ticketId = id;
	}

	if (countActiveApiTokens(locals.user.id) >= MAX_ACTIVE_TOKENS) {
		throw error(409, `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
	}

	const canReply = body.canReply !== false;
	const name =
		typeof body.name === 'string' && body.name.trim()
			? body.name.trim()
			: ticketId !== null
				? `Ticket #${ticketId} agent`
				: 'Agent token';

	const { token, info } = createApiToken({ userId: locals.user.id, name, ticketId, canReply });
	audit('token.created', {
		actor: locals.user,
		target: ticketId !== null ? `ticket:${ticketId}` : `user:${locals.user.id}`,
		detail: { token_id: info.id, can_reply: canReply, expires_at: info.expires_at }
	});

	return json({ token, info }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
