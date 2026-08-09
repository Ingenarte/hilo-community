import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createProject,
	deleteProject,
	listProjectsWithCounts,
	renameProject
} from '$lib/server/tickets';
import { db } from '$lib/server/db';
import { audit } from '$lib/server/audit';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

export const GET: RequestHandler = ({ locals }) => {
	requireAdmin(locals);
	return json({ projects: listProjectsWithCounts() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { name?: string };
	try {
		const project = createProject(String(data.name ?? ''));
		return json({ ok: true, project });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as {
		id?: number;
		name?: string;
		status?: 'active' | 'archived';
	};
	const id = Number(data.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'id is required');
	try {
		if (typeof data.name === 'string' && data.name.trim()) {
			renameProject(id, data.name);
		}
		if (data.status) {
			const validStatuses = ['active', 'archived'];
			if (!validStatuses.includes(data.status)) {
				throw error(400, 'invalid status');
			}
			db.prepare('UPDATE projects SET status = ? WHERE id = ?').run(data.status, id);
			audit('project.status.changed', {
				actor: locals.user,
				target: `project:${id}`,
				detail: { status: data.status }
			});
		}
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { id?: number; force?: boolean };
	const id = Number(data.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'id is required');
	try {
		deleteProject(id, { force: !!data.force });
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
