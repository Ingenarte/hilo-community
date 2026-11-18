import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import {
	MAX_ACTIVE_TOKENS,
	countActiveApiTokens,
	createApiToken,
	listApiTokens,
	maxTokenTtlDays
} from '$lib/server/apiTokens';
import { resolveTokenTtl } from '$lib/server/tokenCrypto';
import { rateLimit } from '$lib/server/rateLimit';
import { canAccessTicket, getTicket } from '$lib/server/tickets';
import { db } from '$lib/server/db';

/**
 * Token management. Browser session only: the hook rejects bearer tokens on
 * every path outside /api/v1/*, so a token can never mint or list tokens.
 *
 * GET  /api/tokens  -> my active tokens (never the secret)
 * POST /api/tokens  { ticketId?: number, canReply?: boolean, canCreate?: boolean,
 *                     projectId?: number, name?: string, ttlDays?: number }
 *   Creates a token that expires in 96 hours. The secret is returned once.
 *   Admins may pass `ttlDays` (4, 30, 90 or 365, capped by
 *   API_TOKEN_MAX_TTL_DAYS) for long-lived service tokens; other users may
 *   only use the default.
 *   `canCreate` lets the token open tickets (POST /api/v1/tickets); it cannot be
 *   combined with `ticketId`. `projectId` restricts ticket creation to one
 *   active project the user is assigned to (admins: any active project).
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
		canCreate?: unknown;
		projectId?: unknown;
		name?: unknown;
		ttlDays?: unknown;
	};

	const ttl = resolveTokenTtl(body.ttlDays, locals.user.role === 'admin', maxTokenTtlDays());
	if ('error' in ttl) throw error(400, ttl.error);

	let ticketId: number | null = null;
	if (body.ticketId !== undefined && body.ticketId !== null) {
		const id = Number(body.ticketId);
		if (!Number.isInteger(id) || id <= 0) throw error(400, 'ticketId must be a ticket id');
		const t = getTicket(id);
		if (!t || !canAccessTicket(locals.user, t)) throw error(404, 'Ticket not found');
		ticketId = id;
	}

	const canCreate = body.canCreate === true;
	if (canCreate && ticketId !== null) {
		throw error(400, 'A token limited to one ticket cannot open new tickets');
	}
	let projectId: number | null = null;
	if (body.projectId !== undefined && body.projectId !== null) {
		if (!canCreate) throw error(400, 'projectId only applies to tokens that can open tickets');
		const id = Number(body.projectId);
		if (!Number.isInteger(id) || id <= 0) throw error(400, 'projectId must be a project id');
		const p = db.prepare('SELECT status FROM projects WHERE id = ?').get(id) as
			| { status: string }
			| undefined;
		const assigned =
			locals.user.role === 'admin' ||
			!!db.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?').get(locals.user.id, id);
		if (!p || p.status !== 'active' || !assigned) throw error(404, 'Project not found');
		projectId = id;
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

	const { token, info } = createApiToken({
		userId: locals.user.id,
		name,
		ticketId,
		canReply,
		canCreate,
		projectId,
		ttlSeconds: ttl.seconds
	});
	audit('token.created', {
		actor: locals.user,
		target: ticketId !== null ? `ticket:${ticketId}` : `user:${locals.user.id}`,
		detail: {
			token_id: info.id,
			can_reply: canReply,
			can_create: canCreate,
			project_id: projectId,
			ttl_seconds: ttl.seconds,
			expires_at: info.expires_at
		}
	});

	return json({ token, info }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
