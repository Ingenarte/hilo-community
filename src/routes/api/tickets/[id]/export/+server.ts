import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessTicket, getTicket } from '$lib/server/tickets';
import { audit } from '$lib/server/audit';
import { rateLimit } from '$lib/server/rateLimit';
import { buildExportResponse } from '$lib/server/export';
import { collectTicket } from '$lib/server/export/collect';
import { EXPORT_FORMATS, type ExportFormat } from '$lib/server/export/types';

/**
 * GET /api/tickets/:id/export?format=md|pdf|docx   (default md)
 *
 * md   -> Markdown; a ZIP (ticket.md + assets/) when the ticket has attachments
 * pdf  -> PDF with images embedded; other attachments listed
 * docx -> Word document with images embedded; other attachments listed
 *
 * Available to anyone who can read the ticket. Internal notes are included
 * only for admins.
 */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');

	const format = (url.searchParams.get('format') ?? 'md') as ExportFormat;
	if (!EXPORT_FORMATS.includes(format)) throw error(400, 'format must be md, pdf or docx');

	const t = getTicket(id);
	if (!t) throw error(404, 'Not found');
	if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');

	const rl = rateLimit(`export:user:${locals.user.id}`, 20, 60);
	if (!rl.ok) throw error(429, 'Too many exports, try again in a minute.');

	const ticket = collectTicket(id, { id: locals.user.id, role: locals.user.role });
	if (!ticket) throw error(404, 'Not found');

	// Build first: it can still reject (413) and a refused export is not logged.
	const response = await buildExportResponse([ticket], format);
	audit('ticket.exported', { actor: locals.user, target: `ticket:${id}`, detail: { format } });
	return response;
};
