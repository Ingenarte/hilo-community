import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAttachment } from '$lib/server/tickets';
import { limited, loadScopedTicket, requireAuth, v1Error } from '$lib/server/apiV1';
import { GET as serveAttachment } from '../../../attachments/[id]/+server';

/**
 * GET /api/v1/attachments/:id : the file (supports Range). The token must be
 * allowed to see the ticket the attachment belongs to.
 */
export const GET: RequestHandler = (event) => {
	const auth = requireAuth(event.locals);
	if (auth instanceof Response) return auth;
	const rl = limited(auth.token, 'read', 120, 60);
	if (rl) return rl;

	const attId = Number(event.params.id);
	if (!Number.isInteger(attId) || attId <= 0 || !getAttachment(attId)) {
		return v1Error(404, 'Attachment not found');
	}
	const row = db
		.prepare(
			`SELECT m.ticket_id FROM attachments a JOIN messages m ON m.id = a.message_id
			 WHERE a.id = ? AND m.deleted_at IS NULL`
		)
		.get(attId) as { ticket_id: number } | undefined;
	if (!row) return v1Error(404, 'Attachment not found');

	const loaded = loadScopedTicket(auth, String(row.ticket_id));
	if (!loaded.ok) return v1Error(404, 'Attachment not found');

	return serveAttachment(event as unknown as Parameters<typeof serveAttachment>[0]);
};
