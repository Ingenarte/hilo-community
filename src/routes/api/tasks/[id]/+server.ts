/**
 * PATCH  /api/tasks/[id] — toggle `completed` flag or edit title/description.
 * DELETE /api/tasks/[id] — admin-only remove.
 *
 * Toggling completed is allowed for the assignee and any admin.
 * Editing title/description is allowed for the original creator and any
 * admin. Deletion is admin-only. Each path broadcasts a per-ticket SSE
 * `'task'` event so the sidebar refreshes for everyone watching.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessTicket, getTicket } from '$lib/server/tickets';
import {
	canDeleteTask,
	canEditTask,
	canToggleTask,
	deleteTask,
	editTaskText,
	getTask,
	setTaskCompleted
} from '$lib/server/tasks';
import { broadcast } from '$lib/server/sse';

function loadAuthorisedTask(taskId: number, locals: App.Locals) {
	if (!locals.user) throw error(401, 'Unauthorized');
	const task = getTask(taskId);
	if (!task) throw error(404, 'Task not found');
	const ticket = getTicket(task.ticket_id);
	if (!ticket) throw error(404, 'Ticket not found');
	if (!canAccessTicket(locals.user, ticket)) throw error(403, 'Forbidden');
	return { task, ticket };
}

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'invalid id');
	const { task } = loadAuthorisedTask(id, locals);
	if (!locals.user) throw error(401, 'Unauthorized'); // narrows the type guard

	const body = (await request.json().catch(() => null)) as {
		completed?: boolean;
		title?: string;
		description?: string;
	} | null;
	if (!body) throw error(400, 'invalid body');

	if (typeof body.completed === 'boolean') {
		if (!canToggleTask(locals.user, task)) {
			throw error(403, 'Only the assignee or an admin can change the status');
		}
		setTaskCompleted(task.id, body.completed, locals.user.id);
	}

	if (typeof body.title === 'string' || typeof body.description === 'string') {
		if (!canEditTask(locals.user, task)) {
			throw error(403, 'Only the creator or an admin can edit the task');
		}
		try {
			editTaskText(task.id, body.title ?? task.title, body.description ?? task.description);
		} catch (e) {
			throw error(400, e instanceof Error ? e.message : 'invalid payload');
		}
	}

	const fresh = getTask(task.id);
	broadcast(task.ticket_id, 'task', { id: task.id, kind: 'update' });
	return json({ ok: true, task: fresh });
};

export const DELETE: RequestHandler = ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'invalid id');
	const { task } = loadAuthorisedTask(id, locals);
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!canDeleteTask(locals.user)) throw error(403, 'Admin only');
	deleteTask(task.id);
	broadcast(task.ticket_id, 'task', { id: task.id, kind: 'delete' });
	return json({ ok: true });
};
