/**
 * Pending tasks on tickets.
 *
 * - Admins and the ticket owner can create tasks (see canCreateTask).
 * - The assignee and any admin can toggle a task between pending and
 *   done (see canToggleTask).
 * - Admins can edit the title/description of any task and delete it.
 * - Multiple open tasks per (ticket, user) are allowed by design.
 *
 * Query shape mirrors the rest of `$lib/server`: single-task helpers
 * for detail pages, batched helpers for the inbox.
 */

import { db } from './db';
import type { DBTicketTask } from './db';

export type TaskWithPeople = DBTicketTask & {
	assignee_email: string;
	created_by_email: string;
	completed_by_email: string | null;
};

export type TaskActor = { id: number; role: 'user' | 'admin' };

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;

/** Admin OR the ticket owner can assign a task. */
export function canCreateTask(
	actor: TaskActor,
	ticket: { user_id: number }
): boolean {
	return actor.role === 'admin' || actor.id === ticket.user_id;
}

/** The assignee themselves or any admin can flip the completed state. */
export function canToggleTask(actor: TaskActor, task: DBTicketTask): boolean {
	return actor.role === 'admin' || actor.id === task.assignee_user_id;
}

/** Only admins or the original creator can edit a task's text. */
export function canEditTask(actor: TaskActor, task: DBTicketTask): boolean {
	return actor.role === 'admin' || actor.id === task.created_by_user_id;
}

/** Only admins can delete a task. */
export function canDeleteTask(actor: TaskActor): boolean {
	return actor.role === 'admin';
}

function validateText(field: string, value: string, max: number): string {
	const trimmed = (value ?? '').trim();
	if (trimmed.length > max) {
		throw new Error(`${field} is too long (max ${max} chars)`);
	}
	return trimmed;
}

/** Resolve a single task with the participant emails inlined. */
function rowWithEmails(taskId: number): TaskWithPeople | null {
	const row = db
		.prepare(
			`SELECT t.*,
			        a.email  AS assignee_email,
			        c.email  AS created_by_email,
			        d.email  AS completed_by_email
			 FROM ticket_tasks t
			 JOIN users a ON a.id = t.assignee_user_id
			 JOIN users c ON c.id = t.created_by_user_id
			 LEFT JOIN users d ON d.id = t.completed_by_user_id
			 WHERE t.id = ?`
		)
		.get(taskId) as TaskWithPeople | undefined;
	return row ?? null;
}

export function getTask(taskId: number): TaskWithPeople | null {
	return rowWithEmails(taskId);
}

/** All tasks attached to a ticket, open first, both ordered newest-first within each group. */
export function getTasksForTicket(ticketId: number): TaskWithPeople[] {
	return db
		.prepare(
			`SELECT t.*,
			        a.email  AS assignee_email,
			        c.email  AS created_by_email,
			        d.email  AS completed_by_email
			 FROM ticket_tasks t
			 JOIN users a ON a.id = t.assignee_user_id
			 JOIN users c ON c.id = t.created_by_user_id
			 LEFT JOIN users d ON d.id = t.completed_by_user_id
			 WHERE t.ticket_id = ?
			 ORDER BY (t.completed_at IS NOT NULL) ASC,
			          t.created_at DESC, t.id DESC`
		)
		.all(ticketId) as TaskWithPeople[];
}

/**
 * Batched inbox helper: for the given viewer and a set of ticket ids,
 * return the OPEN tasks assigned to that viewer keyed by ticket id.
 * Used by the inbox row to (a) decide whether to show the amber chip
 * and (b) populate the hover tooltip.
 */
export function getOpenTasksByTicketForUser(
	viewerUserId: number,
	ticketIds: number[]
): Map<number, Array<{ id: number; title: string; description: string }>> {
	const result = new Map<number, Array<{ id: number; title: string; description: string }>>();
	if (ticketIds.length === 0) return result;
	const placeholders = ticketIds.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`SELECT id, ticket_id, title, description
			 FROM ticket_tasks
			 WHERE assignee_user_id = ?
			   AND completed_at IS NULL
			   AND ticket_id IN (${placeholders})
			 ORDER BY ticket_id, created_at DESC, id DESC`
		)
		.all(viewerUserId, ...ticketIds) as Array<{
		id: number;
		ticket_id: number;
		title: string;
		description: string;
	}>;
	for (const row of rows) {
		const list = result.get(row.ticket_id);
		const item = { id: row.id, title: row.title, description: row.description };
		if (list) list.push(item);
		else result.set(row.ticket_id, [item]);
	}
	return result;
}

export function createTask(args: {
	ticketId: number;
	assigneeUserId: number;
	createdByUserId: number;
	title: string;
	description: string;
}): TaskWithPeople {
	const title = validateText('title', args.title, TITLE_MAX);
	if (!title) throw new Error('title is required');
	const description = validateText('description', args.description ?? '', DESCRIPTION_MAX);
	const info = db
		.prepare(
			`INSERT INTO ticket_tasks
			   (ticket_id, assignee_user_id, created_by_user_id, title, description)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.run(args.ticketId, args.assigneeUserId, args.createdByUserId, title, description);
	const row = rowWithEmails(Number(info.lastInsertRowid));
	if (!row) throw new Error('Failed to read back created task');
	return row;
}

export function setTaskCompleted(
	taskId: number,
	completed: boolean,
	actorUserId: number
): TaskWithPeople | null {
	if (completed) {
		db.prepare(
			`UPDATE ticket_tasks
			 SET completed_at = unixepoch(), completed_by_user_id = ?
			 WHERE id = ?`
		).run(actorUserId, taskId);
	} else {
		db.prepare(
			`UPDATE ticket_tasks
			 SET completed_at = NULL, completed_by_user_id = NULL
			 WHERE id = ?`
		).run(taskId);
	}
	return rowWithEmails(taskId);
}

export function editTaskText(
	taskId: number,
	title: string,
	description: string
): TaskWithPeople | null {
	const cleanTitle = validateText('title', title, TITLE_MAX);
	if (!cleanTitle) throw new Error('title is required');
	const cleanDescription = validateText('description', description, DESCRIPTION_MAX);
	db.prepare(
		`UPDATE ticket_tasks SET title = ?, description = ? WHERE id = ?`
	).run(cleanTitle, cleanDescription, taskId);
	return rowWithEmails(taskId);
}

export function deleteTask(taskId: number): void {
	db.prepare('DELETE FROM ticket_tasks WHERE id = ?').run(taskId);
}
