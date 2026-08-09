import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	canAccessTicket,
	getMessagesForTicket,
	getTicket,
	getTicketParticipants,
	getTicketProjects,
	listAssignableForTicket,
	listFollowers,
	listProjects,
	setTicketPriority,
	setTicketStatus
} from '$lib/server/tickets';
import { getGroup } from '$lib/server/groups';
import { getLastReadAt } from '$lib/server/reads';
import { db } from '$lib/server/db';
import { PRIORITIES, type TicketPriority } from '$lib/server/db';
import { getTasksForTicket } from '$lib/server/tasks';

export const load: PageServerLoad = ({ locals, params }) => {
	if (!locals.user) throw redirect(302, '/login');

	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Ticket not found');

	const ticket = getTicket(id);
	if (!ticket) throw error(404, 'Ticket not found');

	if (!canAccessTicket(locals.user, ticket)) {
		throw error(403, 'Forbidden');
	}

	const rawMessages = getMessagesForTicket(id, { id: locals.user.id, role: locals.user.role });

	// Sprint D: tag each message as unread relative to the user's persisted
	// last_read_at. We DON'T bump that mark here — the client posts to
	// /api/tickets/[id]/read after a short focus delay (~2s) so the
	// "NEW" pills are actually seen before they disappear. Repeated
	// invalidations triggered by unrelated SSE events therefore leave
	// the unread flags stable until the user has had time to look.
	const userId = locals.user.id;
	const lastReadBefore = getLastReadAt(id, userId);
	const messages = rawMessages.map((m) => ({
		...m,
		unread: m.sender_id !== userId && m.created_at > lastReadBefore && !m.deleted_at
	}));

	// Read receipts: anyone who has opened this ticket at least once,
	// with the timestamp of their most recent open. The page renders
	// "Read by …" under the viewer's most recent own message when a
	// participant's `last_read_at` is later than that message's
	// `created_at`. The author themselves is filtered out at render
	// time (they implicitly "read" everything they sent).
	const participantReads = db
		.prepare(
			`SELECT r.user_id, u.email, r.last_read_at
			 FROM ticket_reads r
			 JOIN users u ON u.id = r.user_id
			 WHERE r.ticket_id = ?
			 ORDER BY r.last_read_at DESC`
		)
		.all(id) as Array<{ user_id: number; email: string; last_read_at: number }>;

	const projects = getTicketProjects(id);
	const admins = locals.user.role === 'admin' ? listAssignableForTicket(id) : [];
	const allProjects = locals.user.role === 'admin' ? listProjects() : [];
	const followers = listFollowers(id);
	const participants = getTicketParticipants(id);
	let group: { id: number; name: string; project_name: string } | null = null;
	if (ticket.group_id) {
		const g = getGroup(ticket.group_id);
		if (g) {
			const proj = db
				.prepare('SELECT name FROM projects WHERE id = ?')
				.get(g.project_id) as { name: string } | undefined;
			group = { id: g.id, name: g.name, project_name: proj?.name ?? '' };
		}
	}
	const tasks = getTasksForTicket(id);

	return {
		ticket,
		messages,
		projects,
		allProjects,
		group,
		admins,
		followers,
		participants,
		participantReads,
		tasks,
		lastReadBefore,
		isAdmin: locals.user.role === 'admin',
		currentUserId: locals.user.id
	};
};

export const actions: Actions = {
	close: async ({ locals, params }) => {
		if (!locals.user) throw redirect(302, '/login');
		const id = Number(params.id);
		if (!Number.isFinite(id)) throw error(404, 'Ticket not found');
		const t = getTicket(id);
		if (!t) throw error(404, 'Ticket not found');
		if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');
		setTicketStatus(id, 'closed');
		return { ok: true };
	},
	reopen: async ({ locals, params }) => {
		if (!locals.user) throw redirect(302, '/login');
		const id = Number(params.id);
		if (!Number.isFinite(id)) throw error(404, 'Ticket not found');
		const t = getTicket(id);
		if (!t) throw error(404, 'Ticket not found');
		if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');
		setTicketStatus(id, 'open');
		return { ok: true };
	},
	priority: async ({ locals, params, request }) => {
		// Admin-only — letting the user escalate their own ticket would invite abuse.
		if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
		const id = Number(params.id);
		if (!Number.isFinite(id)) throw error(404, 'Ticket not found');
		const form = await request.formData();
		const next = String(form.get('priority') || '') as TicketPriority;
		if (!PRIORITIES.includes(next)) throw error(400, 'Invalid priority');
		setTicketPriority(id, next);
		return { ok: true };
	}
};
