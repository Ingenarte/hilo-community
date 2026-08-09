import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteGroup, getGroup, renameGroup } from '$lib/server/groups';
import { audit } from '$lib/server/audit';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

export const GET: RequestHandler = ({ locals, params }) => {
	requireAdmin(locals);
	const g = getGroup(Number(params.id));
	if (!g) throw error(404, 'Group not found');
	return json({ group: g });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'invalid id');
	const body = (await request.json().catch(() => ({}))) as { name?: string };
	const name = String(body.name ?? '').trim();
	if (!name) throw error(400, 'name is required');
	try {
		renameGroup(id, name);
		audit('group.renamed', {
			actor: locals.user,
			target: `group:${id}`,
			detail: { name }
		});
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'invalid id');
	deleteGroup(id);
	audit('group.deleted', { actor: locals.user, target: `group:${id}` });
	return json({ ok: true });
};
