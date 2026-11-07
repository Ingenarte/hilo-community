import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTicket, getTicketProjects, setTicketProjects } from '$lib/server/tickets';
import { db } from '$lib/server/db';
import { audit } from '$lib/server/audit';
import { notifyTicketMovement } from '$lib/server/notify';

/**
 * POST /api/tickets/:id/projects  { projectIds: number[] }
 *
 * Admin-only: replace the ticket's project tags with the given ids. Used
 * by the sidebar UI to correct what the user picked when they opened the
 * ticket. Empty array clears all tags.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Ticket not found');
	const ticket = getTicket(id);
	if (!ticket) throw error(404, 'Ticket not found');

	const data = (await request.json().catch(() => ({}))) as { projectIds?: number[] };
	const ids = Array.isArray(data.projectIds) ? data.projectIds.map(Number) : [];
	const before = getTicketProjects(id).map((p) => p.id);
	const valid = ids.filter((n) =>
		db.prepare(`SELECT 1 FROM projects WHERE id = ? AND status != 'archived'`).get(n)
	);
	setTicketProjects(id, valid);
	// A requested project that no ticket uses any more is dropped with the request.
	for (const pid of before) {
		if (valid.includes(pid)) continue;
		const row = db.prepare('SELECT status FROM projects WHERE id = ?').get(pid) as { status: string } | undefined;
		const left = db.prepare('SELECT COUNT(*) AS n FROM ticket_projects WHERE project_id = ?').get(pid) as { n: number };
		if (row?.status === 'pending' && left.n === 0) {
			db.prepare('DELETE FROM projects WHERE id = ?').run(pid);
			audit('project.request_dropped', { actor: locals.user, target: `project:${pid}`, detail: { ticket: id } });
		}
	}
	if (valid.length !== before.length || valid.some((n) => !before.includes(n))) {
		const names = getTicketProjects(id).map((p) => p.name);
		notifyTicketMovement({
			ticketId: id,
			actor: locals.user,
			summary: names.length ? `Project changed to ${names.join(', ')}` : 'Project removed'
		});
	}
	audit('ticket.projects_changed', { actor: locals.user, target: `ticket:${id}`, detail: { from: before, to: valid } });
	return json({ ok: true, projects: getTicketProjects(id) });
};
