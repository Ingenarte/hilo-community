import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { revokeApiToken } from '$lib/server/apiTokens';

/** DELETE /api/tokens/:id : revoke one of my tokens immediately. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw error(404, 'Not found');
	if (!revokeApiToken(locals.user.id, id)) throw error(404, 'Not found');
	audit('token.revoked', { actor: locals.user, target: `token:${id}` });
	return json({ ok: true });
};
