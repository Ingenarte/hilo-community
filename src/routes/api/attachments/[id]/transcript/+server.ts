/**
 * GET /api/attachments/[id]/transcript
 *
 * Returns the current transcription state for an audio attachment.
 * Used for initial hydration when a page with an already-transcribed audio
 * attachment loads, and for polling when SSE is unavailable.
 *
 * Access control: same gate as the attachment GET handler (auth + ticket access).
 */

import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import type { DBAttachment } from '$lib/server/db';
import { canAccessTicket } from '$lib/server/tickets';

type AttachmentRow = DBAttachment & { ticket_id: number; user_id: number };

function getAttachmentWithTicket(id: number): AttachmentRow | null {
	return (
		db
			.prepare(
				`SELECT a.*, t.id AS ticket_id, t.user_id
			 FROM attachments a
			 JOIN messages m ON m.id = a.message_id
			 JOIN tickets  t ON t.id = m.ticket_id
			 WHERE a.id = ?`
			)
			.get(id) as AttachmentRow | undefined
	) ?? null;
}

export const GET: RequestHandler = ({ params, locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'Invalid id');

	const att = getAttachmentWithTicket(id);
	if (!att) throw error(404, 'Not found');
	if (!canAccessTicket(locals.user, att)) throw error(403, 'Forbidden');

	return json({
		status: att.transcript_status ?? null,
		text: att.transcript_text ?? '',
		lang: att.transcript_lang ?? '',
		updatedAt: att.transcript_updated_at ?? null
	});
};
