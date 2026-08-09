/**
 * POST /api/attachments/[id]/transcribe
 *
 * Kicks off an async transcription of the audio attachment with the given id.
 * Returns 202 immediately; the result arrives via the SSE 'transcription' event.
 *
 * Idempotent: if the status is already 'pending' or 'ready', returns 200 with
 * the current state instead of re-queuing.
 *
 * Rate-limited: max 10 requests per user per 10 minutes (covers a burst of
 * Transcribe clicks without blocking legitimate use).
 *
 * Access control: caller must be authenticated and must be able to access the
 * ticket that owns the attachment (same gate as the attachment GET handler).
 */

import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync } from 'node:fs';
import { db } from '$lib/server/db';
import type { DBAttachment, TranscriptStatus } from '$lib/server/db';
import { canAccessTicket } from '$lib/server/tickets';
import { uploadPath } from '$lib/server/uploads';
import { transcribe } from '$lib/server/transcribe';
import { broadcast } from '$lib/server/sse';
import { rateLimit } from '$lib/server/rateLimit';
import { log } from '$lib/server/logger';

// ── helpers ──────────────────────────────────────────────────────────────────

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

const setStatus = db.prepare(
	`UPDATE attachments
	 SET transcript_status = ?, transcript_updated_at = unixepoch()
	 WHERE id = ?`
);

const setResult = db.prepare(
	`UPDATE attachments
	 SET transcript_status = ?, transcript_text = ?, transcript_lang = ?,
	     transcript_updated_at = unixepoch()
	 WHERE id = ?`
);

// ── handler ──────────────────────────────────────────────────────────────────

export const POST: RequestHandler = ({ params, locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'Invalid id');

	// Rate limit per user: 10 per 10 minutes.
	const rl = rateLimit(`transcribe:user:${locals.user.id}`, 10, 600);
	if (!rl.ok) {
		throw error(429, `Too many transcription requests. Retry in ${rl.retryAfterSeconds}s.`);
	}

	const att = getAttachmentWithTicket(id);
	if (!att) throw error(404, 'Not found');
	if (!canAccessTicket(locals.user, att)) throw error(403, 'Forbidden');

	// Only audio attachments can be transcribed.
	if (!att.mime_type.startsWith('audio/')) {
		throw error(422, 'Not an audio attachment');
	}

	// Idempotency: if already pending or ready, return current state.
	if (att.transcript_status === 'pending' || att.transcript_status === 'ready') {
		return json(
			{
				status: att.transcript_status,
				text: att.transcript_text ?? '',
				lang: att.transcript_lang ?? '',
				updatedAt: att.transcript_updated_at
			},
			{ status: 200 }
		);
	}

	// Mark pending synchronously before returning the 202.
	setStatus.run('pending', id);
	const ticketId = att.ticket_id;

	// Fire-and-forget: do not await. The HTTP response goes out immediately.
	(async () => {
		try {
			const filePath = uploadPath(att.stored_name);
			const audio = readFileSync(filePath);
			const result = await transcribe({ audio, mime: att.mime_type });
			setResult.run('ready', result.text, result.language, id);
			log.info('transcription ready', {
				attachment_id: id,
				chars: result.text.length,
				lang: result.language,
				durationMs: result.durationMs
			});
			broadcast(ticketId, 'transcription', {
				attachment_id: id,
				status: 'ready' satisfies TranscriptStatus,
				text: result.text,
				lang: result.language
			});
		} catch (err) {
			setStatus.run('failed', id);
			log.error('transcription failed', {
				attachment_id: id,
				err: err instanceof Error ? err.message : String(err)
			});
			broadcast(ticketId, 'transcription', {
				attachment_id: id,
				status: 'failed' satisfies TranscriptStatus,
				text: '',
				lang: ''
			});
		}
	})();

	return json({ status: 'pending' }, { status: 202 });
};
