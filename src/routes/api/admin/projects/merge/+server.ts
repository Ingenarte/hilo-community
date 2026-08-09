import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mergeProjects } from '$lib/server/tickets';

/**
 * POST /api/admin/projects/merge  { fromId, intoId }
 * Move every ticket association from `fromId` into `intoId`, then delete
 * `fromId`. Useful for cleaning typos accumulated before tightening project
 * creation to admin-only.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
	const data = (await request.json().catch(() => ({}))) as {
		fromId?: number;
		intoId?: number;
	};
	const fromId = Number(data.fromId);
	const intoId = Number(data.intoId);
	if (!Number.isFinite(fromId) || !Number.isFinite(intoId))
		return json({ error: 'fromId and intoId are required' }, { status: 400 });
	if (fromId === intoId) return json({ error: 'fromId and intoId must differ' }, { status: 400 });
	try {
		mergeProjects(fromId, intoId);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
