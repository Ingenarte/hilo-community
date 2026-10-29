import type { RequestHandler } from './$types';
import { config } from '$lib/server/env';
import { requireAuth, v1Json } from '$lib/server/apiV1';

/** GET /api/v1/me : who this token acts as and what it may do. */
export const GET: RequestHandler = ({ locals }) => {
	const auth = requireAuth(locals);
	if (auth instanceof Response) return auth;
	const now = Math.floor(Date.now() / 1000);
	return v1Json({
		user: { email: auth.user.email, role: auth.user.role },
		token: {
			name: auth.token.name,
			ticket_id: auth.token.ticketId,
			can_reply: auth.token.canReply,
			expires_at: auth.token.expiresAt,
			expires_in_seconds: Math.max(0, auth.token.expiresAt - now)
		},
		base_url: config.publicBaseUrl.replace(/\/$/, '')
	});
};
