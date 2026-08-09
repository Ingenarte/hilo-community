import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	addAttachment,
	appendMessage,
	canAccessTicket,
	getTicket
} from '$lib/server/tickets';
import { isAllowedMime, normalizeMimeForFile, saveUploadedFile } from '$lib/server/uploads';
import { config } from '$lib/server/env';
import { broadcast } from '$lib/server/sse';
import { dispatchWebhooks } from '$lib/server/webhooks';
import { fanOutMessageNotification } from '$lib/server/notify';
import { db } from '$lib/server/db';

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw redirect(303, '/login');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Ticket not found');

	const t = getTicket(id);
	if (!t) throw error(404, 'Ticket not found');
	if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');

	// Defensive content-type check: the endpoint only accepts multipart and
	// urlencoded payloads. Without this, sending JSON would crash with an
	// undici TypeError and surface as a generic 500.
	const ctype = (request.headers.get('content-type') || '').toLowerCase();
	if (
		!ctype.startsWith('multipart/form-data') &&
		!ctype.startsWith('application/x-www-form-urlencoded')
	) {
		return json(
			{ error: 'Content-Type must be multipart/form-data or application/x-www-form-urlencoded.' },
			{ status: 415 }
		);
	}

	const form = await request.formData();
	const body = String(form.get('body') || '').trim();
	const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
	// Admin-only flag for internal notes (invisible to the ticket owner).
	const internal = locals.user.role === 'admin' && String(form.get('internal') || '') === '1';
	// Optional reply threading: repliedToMessageId ties this message to a prior one.
	const repliedToRaw = form.get('repliedToMessageId');
	const repliedToMessageId =
		repliedToRaw != null && repliedToRaw !== '' ? Number(repliedToRaw) : null;

	// Accept both the new field name and the legacy field for one-release
	// backward compatibility. The client emits upload_session_ids as of
	// this sprint. Older in-flight requests may still send the legacy field.
	let preUploadedRaw = form.getAll('upload_session_ids');
	if (preUploadedRaw.length === 0) {
		preUploadedRaw = form.getAll('pre_uploaded_attachment_ids');
		if (preUploadedRaw.length > 0) {
			console.warn(
				'[messages] received legacy pre_uploaded_attachment_ids; client should use upload_session_ids'
			);
		}
	}
	const preUploadedIds: string[] = preUploadedRaw
		.flatMap((v) => String(v).split(','))
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	if (!body && files.length === 0 && preUploadedIds.length === 0)
		return json({ error: 'Empty message — write something or attach a file.' }, { status: 400 });

	// The single-shot path still enforces the legacy 100 MB cap per file.
	// Files larger than that must go through the chunked upload pipeline.
	const singleShotMaxBytes = 100 * 1024 * 1024;

	// Normalize files: infer MIME from filename extension when the client sends
	// an empty MIME (e.g. macOS drag-and-drop screenshots). This is defence-in-depth
	// — the Composer already normalizes at ingestion, but older bundles or
	// third-party tools may still reach here with an empty MIME.
	const normalizedFiles = files.map((f) => {
		const mime = normalizeMimeForFile(f.name, f.type);
		if (mime === f.type) return f;
		return new File([f], f.name, { type: mime, lastModified: f.lastModified });
	});

	for (const f of normalizedFiles) {
		if (f.size > singleShotMaxBytes)
			return json(
				{ error: `${f.name} exceeds the 100 MB single-shot limit. Use the chunked upload path for larger files.` },
				{ status: 413 }
			);
		if (!isAllowedMime(f.type)) {
			console.warn('[messages] rejected attachment MIME', {
				ticket_id: params.id,
				filename: f.name,
				mime: f.type || '(empty)',
				size_bytes: f.size
			});
			return json({ error: `${f.name} has unsupported type ${f.type}.` }, { status: 415 });
		}
	}

	// Validate all pre-uploaded session IDs before entering the transaction.
	// We collect session data here; FK constraints mean the message row must
	// exist before attachment rows can be inserted.
	type CompletedSession = {
		id: string;
		filename: string;
		storedName: string;
		mimeType: string;
		sizeBytes: number;
	};
	const completedSessions: CompletedSession[] = [];
	for (const uploadId of preUploadedIds) {
		const session = db
			.prepare('SELECT * FROM upload_sessions WHERE id = ?')
			.get(uploadId) as import('$lib/server/db').DBUploadSession | undefined;
		if (!session) {
			return json(
				{ error: `Pre-uploaded attachment ${uploadId} not found.` },
				{ status: 400 }
			);
		}
		if (session.user_id !== locals.user.id && locals.user.role !== 'admin') {
			return json(
				{ error: `Pre-uploaded attachment ${uploadId} belongs to another user.` },
				{ status: 403 }
			);
		}
		// Re-check: session must be 'complete' and belong to this ticket.
		// These checks run again inside the transaction for safety.
		if (session.status !== 'complete') {
			return json(
				{ error: `Pre-uploaded attachment ${uploadId} is not complete (status: ${session.status}).` },
				{ status: 400 }
			);
		}
		if (session.ticket_id !== id) {
			return json(
				{ error: `Pre-uploaded attachment ${uploadId} belongs to a different ticket.` },
				{ status: 400 }
			);
		}
		// After completeUploadSession(), `partial_path` holds the storedName.
		// Apply extension-based MIME inference so the attachment row always stores
		// a meaningful MIME even when the client sent 'application/octet-stream'.
		completedSessions.push({
			id: uploadId,
			filename: session.filename,
			storedName: session.partial_path, // repurposed after complete()
			mimeType: normalizeMimeForFile(session.filename, session.mime_type),
			sizeBytes: session.total_bytes
		});
	}

	// Save single-shot files to disk BEFORE the transaction. File I/O
	// must not run inside a SQLite transaction (can block the DB thread).
	const savedSingleShot: Array<{
		id: number;
		filename: string;
		stored_name: string;
		mime_type: string;
		size_bytes: number;
	}> = [];
	for (const f of normalizedFiles) {
		const saved = await saveUploadedFile(f);
		// We do not insert the attachment row here; that happens in the transaction.
		savedSingleShot.push({
			id: 0, // filled after transaction
			filename: saved.filename,
			stored_name: saved.storedName,
			mime_type: saved.mimeType,
			size_bytes: saved.sizeBytes
		});
	}

	// ── Atomic transaction ──────────────────────────────────────────────────────
	// Insert the message row, all attachment rows, and mark each upload session
	// 'attached' in a single transaction. This prevents:
	//   - Orphan messages (message row with no attachment rows on crash)
	//   - Replayable sessions (session stays 'complete' → could be included in
	//     a second message if the connection drops after INSERT but before
	//     the session UPDATE)
	let messageId!: number;
	const allAttachments: typeof savedSingleShot = [];

	db.transaction(() => {
		// Re-verify each session inside the transaction to prevent a TOCTOU
		// race where the session status changed between the pre-flight check
		// above and this point.
		for (const uploadId of preUploadedIds) {
			const session = db
				.prepare('SELECT status, ticket_id FROM upload_sessions WHERE id = ?')
				.get(uploadId) as { status: string; ticket_id: number } | undefined;
			if (!session || session.status !== 'complete' || session.ticket_id !== id) {
				throw Object.assign(
					new Error(
						`Upload session ${uploadId} is not in a valid state for attachment (status: ${session?.status ?? 'gone'}).`
					),
					{ status: 409 }
				);
			}
		}

		messageId = appendMessage({
			ticketId: id,
			senderId: locals.user!.id,
			senderRole: locals.user!.role,
			body,
			internal,
			repliedToMessageId
		});

		// Insert single-shot file attachment rows.
		for (const s of savedSingleShot) {
			const attachmentId = addAttachment({
				messageId,
				filename: s.filename,
				storedName: s.stored_name,
				mimeType: s.mime_type,
				sizeBytes: s.size_bytes
			});
			allAttachments.push({ ...s, id: attachmentId });
		}

		// Insert chunked attachment rows and consume each session.
		for (const cs of completedSessions) {
			const attachmentId = addAttachment({
				messageId,
				filename: cs.filename,
				storedName: cs.storedName,
				mimeType: cs.mimeType,
				sizeBytes: cs.sizeBytes
			});
			allAttachments.push({
				id: attachmentId,
				filename: cs.filename,
				stored_name: cs.storedName,
				mime_type: cs.mimeType,
				size_bytes: cs.sizeBytes
			});
			// Mark session 'attached' so it is never included in another message
			// and is excluded from orphan-prune file deletion.
			db.prepare(
				`UPDATE upload_sessions SET status = 'attached' WHERE id = ? AND status = 'complete'`
			).run(cs.id);
		}
	})();

	broadcast(id, 'message', { id: messageId });

	// Internal notes never trigger an email (the ticket owner shouldn't see
	// them) and never fan out to webhooks. Everything else fans out via
	// the shared notification module — email, web push, in-app SSE.
	if (!internal) {
		fanOutMessageNotification({
			ticketId: id,
			ticketTitle: t.title,
			authorEmail: locals.user.email,
			authorRole: locals.user.role,
			body,
			attachments: allAttachments,
			sseKind: 'message',
			fallbackPreview: '(new attachment)'
		}).catch((err) => console.error('[notify] fan-out failed', err));

		const ticketUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/tickets/${id}`;
		dispatchWebhooks('ticket.reply', {
			ticket_id: id,
			title: t.title,
			priority: 'normal',
			status: 'open',
			author: locals.user.email,
			preview: body,
			url: ticketUrl,
			brand: config.brand
		});
	}

	return json({ ok: true, id: messageId, internal });
};
