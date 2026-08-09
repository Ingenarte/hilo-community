import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTicket, getTicketProjects, setTicketProjects } from '$lib/server/tickets';

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
	setTicketProjects(id, ids);
	return json({ ok: true, projects: getTicketProjects(id) });
};
