import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { assertSameOrigin, assertSameOriginJson } from '$lib/server/csrf';
import {
	assertPasskeysEnabled,
	cleanName,
	deletePasskey,
	renamePasskey
} from '$lib/server/passkeys';

function idOf(raw: string): number {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) throw error(404, 'Not found');
	return id;
}

/** DELETE /api/passkeys/:id -> remove one of my passkeys. */
export const DELETE: RequestHandler = ({ locals, params, request, url }) => {
	assertPasskeysEnabled();
	if (!locals.user) throw error(401, 'Unauthorized');
	assertSameOrigin(request, url);
	const id = idOf(params.id);
	if (!deletePasskey(locals.user.id, id)) throw error(404, 'Not found');
	audit('passkey.removed', { actor: locals.user, target: `passkey:${id}` });
	return json({ ok: true });
};

/** PATCH /api/passkeys/:id { name } -> rename. */
export const PATCH: RequestHandler = async ({ locals, params, request, url }) => {
	assertPasskeysEnabled();
	if (!locals.user) throw error(401, 'Unauthorized');
	assertSameOriginJson(request, url);
	const id = idOf(params.id);
	const body = (await request.json().catch(() => ({}))) as { name?: unknown };
	if (!renamePasskey(locals.user.id, id, cleanName(body.name))) throw error(404, 'Not found');
	return json({ ok: true });
};
