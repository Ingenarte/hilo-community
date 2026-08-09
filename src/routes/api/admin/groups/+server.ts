import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createGroup,
	listAllGroupsWithCounts,
	listGroupsForProject
} from '$lib/server/groups';
import { audit } from '$lib/server/audit';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

/**
 * GET /api/admin/groups
 *   ?projectId=N → groups inside that project
 *   (no params)  → flat list with counts (members, tickets, project name)
 *
 * POST /api/admin/groups
 *   body: { projectId, name } → creates a group
 */
export const GET: RequestHandler = ({ locals, url }) => {
	requireAdmin(locals);
	const pid = url.searchParams.get('projectId');
	if (pid) {
		const projectId = Number(pid);
		if (!Number.isFinite(projectId) || projectId <= 0) throw error(400, 'invalid projectId');
		return json({ groups: listGroupsForProject(projectId) });
	}
	return json({ groups: listAllGroupsWithCounts() });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);
	const body = (await request.json().catch(() => ({}))) as {
		projectId?: number;
		name?: string;
	};
	const projectId = Number(body.projectId);
	const name = String(body.name ?? '').trim();
	if (!Number.isFinite(projectId) || projectId <= 0) throw error(400, 'projectId is required');
	if (!name) throw error(400, 'name is required');
	try {
		const g = createGroup({ projectId, name, createdByUserId: locals.user!.id });
		audit('group.created', {
			actor: locals.user,
			target: `group:${g.id}`,
			detail: { projectId, name }
		});
		return json({ ok: true, group: g });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
