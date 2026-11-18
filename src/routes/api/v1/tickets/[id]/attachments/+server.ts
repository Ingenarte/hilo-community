import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { config } from '$lib/server/env';
import { audit } from '$lib/server/audit';
import { TICKET_CLOSED_MESSAGE, addAttachment } from '$lib/server/tickets-messages';
import { isAllowedMime, normalizeMimeForFile, saveUploadedFile } from '$lib/server/uploads';
import { broadcast } from '$lib/server/sse';
import { limited, loadScopedTicket, requireAuth, v1Error, v1Json } from '$lib/server/apiV1';

const MAX_FILES_PER_REQUEST = 10;

/**
 * POST /api/v1/tickets/:id/attachments  (multipart/form-data, field `files`, repeatable)
 * Attaches files to the latest message this same token posted on the ticket
 * (the first message of a ticket it opened, or its latest reply). Needs a token
 * that can open tickets or reply. Each file obeys MAX_UPLOAD_MB and the allowed
 * MIME types of the UI. Rate limit: 10 requests per minute per token.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const auth = requireAuth(locals);
	if (auth instanceof Response) return auth;
	if (!auth.token.canCreate && !auth.token.canReply) return v1Error(403, 'This token is read-only');

	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
		return v1Error(415, 'Content-Type must be multipart/form-data');
	}

	const rl = limited(auth.token, 'attach-minute', 10, 60);
	if (rl) return rl;

	const loaded = loadScopedTicket(auth, params.id);
	if (!loaded.ok) return loaded.response;
	const { id, ticket } = loaded;
	if (ticket.status === 'closed' && auth.user.role !== 'admin') {
		return v1Error(409, TICKET_CLOSED_MESSAGE);
	}

	const message = db
		.prepare(
			`SELECT id FROM messages
			 WHERE ticket_id = ? AND via_token_id = ? AND deleted_at IS NULL
			 ORDER BY id DESC LIMIT 1`
		)
		.get(id, auth.token.id) as { id: number } | undefined;
	if (!message) return v1Error(409, 'Post a message with this token first; files attach to it');

	const form = await request.formData().catch(() => null);
	if (!form) return v1Error(400, 'Invalid multipart body');
	const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
	if (files.length === 0) return v1Error(400, 'At least one file is required in field "files"');
	if (files.length > MAX_FILES_PER_REQUEST) {
		return v1Error(400, `At most ${MAX_FILES_PER_REQUEST} files per request`);
	}

	const maxBytes = config.maxUploadMb * 1024 * 1024;
	for (const f of files) {
		if (f.size > maxBytes) return v1Error(413, `${f.name} exceeds the ${config.maxUploadMb} MB limit`);
		const mime = normalizeMimeForFile(f.name, f.type);
		if (!isAllowedMime(mime)) return v1Error(415, `${f.name} has unsupported type ${mime}`);
	}

	const saved: Array<{ id: number; filename: string; mime_type: string; size_bytes: number }> = [];
	for (const f of files) {
		const stored = { ...(await saveUploadedFile(f)), mimeType: normalizeMimeForFile(f.name, f.type) };
		const attachmentId = addAttachment({ messageId: message.id, ...stored });
		saved.push({
			id: attachmentId,
			filename: stored.filename,
			mime_type: stored.mimeType,
			size_bytes: stored.sizeBytes
		});
	}
	broadcast(id, 'message', { id: message.id });

	audit('ticket.agent_attachments', {
		actor: auth.user,
		target: `ticket:${id}`,
		detail: { token_id: auth.token.id, message_id: message.id, count: saved.length }
	});
	return v1Json({ ok: true, message_id: message.id, attachments: saved }, { status: 201 });
};
