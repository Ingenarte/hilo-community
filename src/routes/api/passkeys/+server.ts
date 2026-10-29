import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertPasskeysEnabled, listPasskeys } from '$lib/server/passkeys';

/** GET /api/passkeys -> my passkeys (never key material). */
export const GET: RequestHandler = ({ locals }) => {
	assertPasskeysEnabled();
	if (!locals.user) throw error(401, 'Unauthorized');
	return json({ passkeys: listPasskeys(locals.user.id) }, { headers: { 'Cache-Control': 'no-store' } });
};
