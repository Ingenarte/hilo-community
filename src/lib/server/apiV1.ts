import { json } from '@sveltejs/kit';
import type { ApiTokenInfo } from './apiTokens';
import type { SessionUser } from './auth';
import { canAccessTicket, getTicket } from './tickets';
import { rateLimit } from './rateLimit';

export function v1Json(data: unknown, init: ResponseInit = {}): Response {
	return json(data, {
		...init,
		headers: { 'Cache-Control': 'no-store', ...(init.headers as Record<string, string> | undefined) }
	});
}

export function v1Error(status: number, message: string): Response {
	return v1Json({ error: message }, { status });
}

export type V1Auth = { user: SessionUser; token: ApiTokenInfo };

/** The hook only fills locals for valid tokens; anything else is a 401. */
export function requireAuth(locals: App.Locals): V1Auth | Response {
	if (!locals.user || !locals.apiToken) return v1Error(401, 'Missing or invalid token');
	return { user: locals.user, token: locals.apiToken };
}

/** Per-token request budget. Returns a 429 response when exceeded. */
export function limited(
	token: ApiTokenInfo,
	bucket: string,
	max: number,
	windowSeconds: number
): Response | null {
	const rl = rateLimit(`v1:${bucket}:${token.id}`, max, windowSeconds);
	if (rl.ok) return null;
	return v1Json(
		{ error: 'Rate limit exceeded', retry_after_seconds: rl.retryAfterSeconds },
		{ status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
	);
}

/**
 * Loads a ticket for an API call and enforces both the user's access and the
 * token's ticket scope. Unknown tickets and tickets outside the token's scope
 * are indistinguishable to the caller (404) so ids cannot be probed.
 */
export type ScopedTicket =
	| { ok: false; response: Response }
	| { ok: true; ticket: NonNullable<ReturnType<typeof getTicket>>; id: number };

export function loadScopedTicket(auth: V1Auth, rawId: string): ScopedTicket {
	const notFound = (): ScopedTicket => ({ ok: false, response: v1Error(404, 'Ticket not found') });
	const id = Number(rawId);
	if (!Number.isInteger(id) || id <= 0) return notFound();
	if (auth.token.ticketId !== null && auth.token.ticketId !== id) return notFound();
	const ticket = getTicket(id);
	if (!ticket || !canAccessTicket(auth.user, ticket)) return notFound();
	return { ok: true, ticket, id };
}

export function ticketUrl(baseUrl: string, id: number): string {
	return `${baseUrl.replace(/\/$/, '')}/tickets/${id}`;
}
