import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	addGroupMember,
	listGroupMembers,
	removeGroupMember,
	setGroupMembers
} from '$lib/server/groups';
import { audit } from '$lib/server/audit';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

/**
 * GET    /api/admin/groups/[id]/members → list current members
 * PUT    /api/admin/groups/[id]/members  body { userIds: number[] } → replace set
 * POST   /api/admin/groups/[id]/members  body { userId }           → add one
 * DELETE /api/admin/groups/[id]/members  body { userId }           → remove one
 */
export const GET: RequestHandler = ({ locals, params }) => {
	requireAdmin(locals);
	const groupId = Number(params.id);
	if (!Number.isFinite(groupId) || groupId <= 0) throw error(400, 'invalid id');
	return json({ members: listGroupMembers(groupId) });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals);
	const groupId = Number(params.id);
	if (!Number.isFinite(groupId) || groupId <= 0) throw error(400, 'invalid id');
	const body = (await request.json().catch(() => ({}))) as { userIds?: number[] };
	const ids = Array.isArray(body.userIds)
		? body.userIds.filter((n): n is number => Number.isFinite(n) && n > 0)
		: [];
	setGroupMembers(groupId, ids);
	audit('group.members.set', {
		actor: locals.user,
		target: `group:${groupId}`,
		detail: { userIds: ids }
	});
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals);
	const groupId = Number(params.id);
	if (!Number.isFinite(groupId) || groupId <= 0) throw error(400, 'invalid id');
	const body = (await request.json().catch(() => ({}))) as { userId?: number };
	const userId = Number(body.userId);
	if (!Number.isFinite(userId) || userId <= 0) throw error(400, 'userId is required');
	addGroupMember(groupId, userId);
	audit('group.member.added', {
		actor: locals.user,
		target: `group:${groupId}`,
		detail: { userId }
	});
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals);
	const groupId = Number(params.id);
	if (!Number.isFinite(groupId) || groupId <= 0) throw error(400, 'invalid id');
	const body = (await request.json().catch(() => ({}))) as { userId?: number };
	const userId = Number(body.userId);
	if (!Number.isFinite(userId) || userId <= 0) throw error(400, 'userId is required');
	removeGroupMember(groupId, userId);
	audit('group.member.removed', {
		actor: locals.user,
		target: `group:${groupId}`,
		detail: { userId }
	});
	return json({ ok: true });
};
