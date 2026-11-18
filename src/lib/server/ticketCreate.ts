import { db } from './db';
import { createTicket } from './tickets';
import { audit } from './audit';
import { DEFAULT_PRIORITY, checkUrgentRequest, isPriority, type Priority } from '$lib/sla';

/** A validation failure with the HTTP status the caller should answer with. */
export class TicketCreateError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export type OpenTicketInput = {
	title?: unknown;
	body?: unknown;
	priority?: unknown;
	priorityReason?: unknown;
	confirmUrgent?: unknown;
	projectId?: unknown;
	newProjectName?: unknown;
};

export type OpenTicketResult = {
	ticketId: number;
	title: string;
	body: string;
	projectId: number;
	priority: Priority;
	approval: 'approved' | 'pending';
};

function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 60) || 'project'
	);
}

/**
 * Shared validation and creation for JSON ticket creation (the UI endpoint
 * POST /api/tickets and the token API POST /api/v1/tickets).
 *
 * Rules:
 *  - `title` and `body` are required.
 *  - `priority` is urgent|high|normal|low (default normal); urgent also needs
 *    `priorityReason` (>= 10 chars) and `confirmUrgent: true`.
 *  - A ticket MUST be associated with a project: either `projectId` (an active
 *    project the user is assigned to; admins bypass the assignment) or
 *    `newProjectName` (admins create it active, users create it pending).
 *  - Tickets opened by users start as awaiting approval; admins create
 *    approved tickets.
 *
 * Creates the ticket row and the audit entry. The caller decides what to do
 * with `body` (store it as the first message, notify, and so on).
 */
export type TicketCreator = { id: number; email: string; role: 'user' | 'admin' };

export function openTicket(user: TicketCreator, input: OpenTicketInput, via?: { tokenId: number }): OpenTicketResult {
	const title = String(input.title ?? '').trim();
	const body = String(input.body ?? '').trim();
	if (!title) throw new TicketCreateError(400, 'title is required');
	if (!body) throw new TicketCreateError(400, 'body is required');

	const priority = input.priority ?? DEFAULT_PRIORITY;
	if (!isPriority(priority)) {
		throw new TicketCreateError(400, 'priority must be urgent, high, normal or low');
	}
	let priorityReason: string | null = null;
	if (priority === 'urgent') {
		const check = checkUrgentRequest(input.priorityReason, input.confirmUrgent as boolean | string);
		if (!check.ok) throw new TicketCreateError(400, check.error);
		priorityReason = check.reason;
	}

	const isAdmin = user.role === 'admin';
	let projectId: number;

	if (typeof input.newProjectName === 'string' && input.newProjectName.trim()) {
		const name = input.newProjectName.trim();
		let slug = slugify(name);
		let suffix = 0;
		while (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
			suffix += 1;
			slug = `${slugify(name)}-${suffix}`;
		}
		const info = db
			.prepare(
				`INSERT INTO projects (name, slug, status, created_by_user_id)
				 VALUES (?, ?, ?, ?)`
			)
			.run(name, slug, isAdmin ? 'active' : 'pending', user.id);
		projectId = Number(info.lastInsertRowid);
		// Admins get the project at once; for everyone else it waits for approval
		// and the requester is only assigned when an admin approves it.
		if (isAdmin) {
			db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)').run(
				user.id,
				projectId
			);
		}
	} else if (typeof input.projectId === 'number' && Number.isInteger(input.projectId)) {
		const project = db.prepare('SELECT status FROM projects WHERE id = ?').get(input.projectId) as
			| { status: string }
			| undefined;
		if (!project) throw new TicketCreateError(404, 'Project not found');
		if (project.status !== 'active') {
			throw new TicketCreateError(400, 'This project does not accept new tickets');
		}
		if (!isAdmin) {
			const ok = db
				.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?')
				.get(user.id, input.projectId);
			if (!ok) throw new TicketCreateError(403, 'You are not assigned to this project');
		}
		projectId = input.projectId;
	} else {
		throw new TicketCreateError(400, 'A project is required');
	}

	const approval = isAdmin ? 'approved' : 'pending';
	const ticketId = createTicket({
		userId: user.id,
		title,
		projectIds: [projectId],
		priority,
		priorityReason,
		approval
	});

	audit('ticket.created', {
		actor: user,
		target: `ticket:${ticketId}`,
		detail: { title, projectId, priority, priorityReason, ...(via ? { token_id: via.tokenId } : {}) }
	});

	return { ticketId, title: title.slice(0, 200), body, projectId, priority, approval };
}
