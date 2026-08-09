import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getTicket, setTicketAssignment } from '$lib/server/tickets';
import { dispatchWebhooks } from '$lib/server/webhooks';
import { config } from '$lib/server/env';

/**
 * POST /api/tickets/:id/assign  { adminUserId: number | null }
 * Admin-only. `null` un-assigns. Fires the `ticket.assigned` webhook.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Ticket not found');

	const t = getTicket(id);
	if (!t) throw error(404, 'Ticket not found');

	const data = (await request.json().catch(() => ({}))) as { adminUserId?: number | null };
	const target = data.adminUserId === null ? null : Number(data.adminUserId);
	if (target !== null && (!Number.isFinite(target) || target <= 0))
		return json({ error: 'adminUserId must be a positive number or null' }, { status: 400 });

	if (target !== null) {
		const row = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'admin'").get(target);
		if (!row) return json({ error: 'Target user is not an admin' }, { status: 400 });
	}

	setTicketAssignment(id, target);

	dispatchWebhooks('ticket.assigned', {
		ticket_id: id,
		title: t.title,
		priority: t.priority,
		status: t.status,
		author: t.user_email,
		preview: target === null ? 'Unassigned' : `Assigned to admin ${target}`,
		url: `${config.publicBaseUrl.replace(/\/$/, '')}/tickets/${id}`,
		brand: config.brand
	});

	return json({ ok: true });
};
