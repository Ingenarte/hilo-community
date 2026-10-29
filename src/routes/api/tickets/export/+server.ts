import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessTicket, getTicket } from '$lib/server/tickets';
import { audit } from '$lib/server/audit';
import { rateLimit } from '$lib/server/rateLimit';
import { MAX_EXPORT_TICKETS, buildExportResponse } from '$lib/server/export';
import { collectTicket } from '$lib/server/export/collect';
import { EXPORT_FORMATS, type ExportFormat, type ExportTicket } from '$lib/server/export/types';

/**
 * POST /api/tickets/export   (form-encoded: ids=1,2,3  format=md|pdf|docx)
 *
 * Exports several tickets as one download: a ZIP with a folder per ticket for
 * md, one combined document for pdf and docx. Tickets the viewer cannot read
 * are skipped; the request fails when none are readable.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const form = await request.formData();
	const format = String(form.get('format') ?? 'md') as ExportFormat;
	if (!EXPORT_FORMATS.includes(format)) throw error(400, 'format must be md, pdf or docx');

	const ids = [
		...new Set(
			form
				.getAll('ids')
				.flatMap((v) => String(v).split(/[\s,]+/))
				.map(Number)
				.filter((n) => Number.isInteger(n) && n > 0)
		)
	].sort((a, b) => a - b);
	if (ids.length === 0) throw error(400, 'Select at least one ticket.');
	if (ids.length > MAX_EXPORT_TICKETS) {
		throw error(400, `Select at most ${MAX_EXPORT_TICKETS} tickets per export.`);
	}

	const rl = rateLimit(`export:user:${locals.user.id}`, 20, 60);
	if (!rl.ok) throw error(429, 'Too many exports, try again in a minute.');

	const viewer = { id: locals.user.id, role: locals.user.role };
	const tickets: ExportTicket[] = [];
	for (const id of ids) {
		const t = getTicket(id);
		if (!t || !canAccessTicket(locals.user, t)) continue;
		const collected = collectTicket(id, viewer);
		if (collected) tickets.push(collected);
	}
	if (tickets.length === 0) throw error(403, 'None of the selected tickets can be exported.');

	// Build first: it can still reject (413) and a refused export is not logged.
	const response = await buildExportResponse(tickets, format);
	audit('ticket.exported', {
		actor: locals.user,
		target: `tickets:${tickets.length}`,
		detail: { format, ids: tickets.map((t) => t.id) }
	});
	return response;
};
