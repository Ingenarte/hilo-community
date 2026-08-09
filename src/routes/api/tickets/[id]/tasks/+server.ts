/**
 * POST /api/tickets/[id]/tasks
 *
 * Create a new pending task on the ticket. The caller must be an admin
 * or the owner of the ticket (see `canCreateTask`). The assignee must
 * be a participant of the ticket — anonymous or stranger user ids are
 * rejected.
 *
 * Body (JSON):
 *   { assignee_user_id: number, title: string, description?: string }
 *
 * On success:
 *   - Broadcasts a per-ticket SSE 'task' event so anyone watching the
 *     ticket detail page refreshes their sidebar.
 *   - Broadcasts a per-user SSE 'activity' event to the assignee so
 *     their inbox and bell update without manual refresh.
 *   - Sends an email + web push to the assignee unless they are the
 *     creator.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessTicket, getTicket, getTicketParticipants } from '$lib/server/tickets';
import { canCreateTask, createTask } from '$lib/server/tasks';
import { broadcast, broadcastToUser } from '$lib/server/sse';
import { sendWebPushToUser } from '$lib/server/webpush';
import { sendTaskNotification } from '$lib/server/email';
import { config } from '$lib/server/env';
import { log } from '$lib/server/logger';

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const ticketId = Number(params.id);
	if (!Number.isFinite(ticketId) || ticketId <= 0) throw error(400, 'invalid id');
	const ticket = getTicket(ticketId);
	if (!ticket) throw error(404, 'Ticket not found');
	if (!canAccessTicket(locals.user, ticket)) throw error(403, 'Forbidden');
	if (!canCreateTask(locals.user, ticket)) {
		throw error(403, 'Only the ticket owner or an admin can assign tasks');
	}

	const body = (await request.json().catch(() => null)) as {
		assignee_user_id?: number;
		title?: string;
		description?: string;
	} | null;
	if (!body) throw error(400, 'invalid body');
	const assigneeUserId = Number(body.assignee_user_id);
	if (!Number.isFinite(assigneeUserId) || assigneeUserId <= 0) {
		throw error(400, 'assignee_user_id is required');
	}

	const participants = getTicketParticipants(ticketId);
	const assignee = participants.find((p) => p.user_id === assigneeUserId);
	if (!assignee) {
		throw error(400, 'Assignee must be a participant of the ticket');
	}

	let task;
	try {
		task = createTask({
			ticketId,
			assigneeUserId,
			createdByUserId: locals.user.id,
			title: body.title ?? '',
			description: body.description ?? ''
		});
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'invalid payload');
	}

	// Notify everyone watching the ticket detail page so the sidebar refreshes.
	broadcast(ticketId, 'task', { id: task.id, kind: 'create' });

	// And the assignee themselves, so their inbox bell + amber chip
	// appear without a manual refresh, unless they assigned to themself.
	if (assigneeUserId !== locals.user.id) {
		broadcastToUser(assigneeUserId, 'activity', {
			ticketId,
			kind: 'task',
			title: ticket.title,
			sender: locals.user.email,
			preview: task.title
		});

		const url = `${config.publicBaseUrl.replace(/\/$/, '')}/tickets/${ticketId}`;
		sendWebPushToUser(assigneeUserId, {
			title: `New task · ${ticket.title}`,
			body: task.title,
			url,
			tag: `hilo-task-${task.id}`
		});

		sendTaskNotification({
			to: task.assignee_email,
			recipientUserId: assigneeUserId,
			ticketId,
			ticketTitle: ticket.title,
			authorEmail: locals.user.email,
			taskTitle: task.title,
			taskDescription: task.description
		}).catch((err) =>
			log.error('task email send failed', {
				taskId: task.id,
				to: task.assignee_email,
				err: err instanceof Error ? err.message : String(err)
			})
		);
	}

	return json({ ok: true, task }, { status: 201 });
};
