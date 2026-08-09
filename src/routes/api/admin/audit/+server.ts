import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAuditEntries } from '$lib/server/audit';

export const GET: RequestHandler = ({ url, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
	const action = url.searchParams.get('action') || undefined;
	const actorId = url.searchParams.get('actor_id');
	const since = url.searchParams.get('since');
	const limit = Number(url.searchParams.get('limit') ?? 100);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const result = listAuditEntries({
		action,
		actorId: actorId ? Number(actorId) : undefined,
		since: since ? Number(since) : undefined,
		limit,
		offset
	});
	return json(result);
};
