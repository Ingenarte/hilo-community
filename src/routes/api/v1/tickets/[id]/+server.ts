import { isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/env';
import { audit } from '$lib/server/audit';
import { getMessagesForTicket, getTicketProjects, setTicketStatus } from '$lib/server/tickets';
import { buildExportResponse } from '$lib/server/export';
import { collectTicket } from '$lib/server/export/collect';
import { attachmentKind } from '$lib/server/export/names';
import { limited, loadScopedTicket, requireAuth, ticketUrl, v1Error, v1Json } from '$lib/server/apiV1';
import { broadcast } from '$lib/server/sse';

/**
 * GET /api/v1/tickets/:id            full ticket as JSON (messages + attachments)
 * GET /api/v1/tickets/:id?format=md  the same as Markdown, or a ZIP with the
 *                                    images/audio/files when it has attachments
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const auth = requireAuth(locals);
	if (auth instanceof Response) return auth;
	const rl = limited(auth.token, 'read', 120, 60);
	if (rl) return rl;
	const loaded = loadScopedTicket(auth, params.id);
	if (!loaded.ok) return loaded.response;
	const { ticket: t, id } = loaded;

	const viewer = { id: auth.user.id, role: auth.user.role };
	const format = url.searchParams.get('format') ?? 'json';

	if (format === 'md') {
		const exportable = collectTicket(id, viewer);
		if (!exportable) return v1Error(404, 'Ticket not found');
		try {
			return await buildExportResponse([exportable], 'md');
		} catch (err) {
			if (isHttpError(err)) return v1Error(err.status, err.body.message);
			throw err;
		}
	}
	if (format !== 'json') return v1Error(400, 'format must be json or md');

	const now = Math.floor(Date.now() / 1000);
	const base = config.publicBaseUrl.replace(/\/$/, '');
	const messages = getMessagesForTicket(id, viewer).map((m) => ({
		id: m.id,
		created_at: m.created_at,
		edited_at: m.edited_at,
		author: m.sender_email,
		author_role: m.sender_role,
		internal: m.internal === 1,
		via_agent: m.via_token_id !== null,
		body: m.body,
		replied_to_id: m.replied_to?.id ?? null,
		attachments: m.attachments.map((a) => ({
			id: a.id,
			filename: a.filename,
			mime_type: a.mime_type,
			kind: attachmentKind(a.mime_type),
			size_bytes: a.size_bytes,
			url: `${base}/api/v1/attachments/${a.id}`,
			transcript:
				a.transcript_status === 'ready' && a.transcript_text
					? { text: a.transcript_text, lang: a.transcript_lang }
					: null
		}))
	}));

	return v1Json({
		ticket: {
			id: t.id,
			title: t.title,
			status: t.status,
			priority: t.priority,
			priority_reason: t.priority_reason,
			sla_due_at: t.sla_due_at,
			sla_remaining_seconds: t.sla_due_at === null ? null : t.sla_due_at - now,
			owner: t.user_email,
			projects: getTicketProjects(id).map((p) => p.name),
			archived: t.archived_at !== null,
			created_at: t.created_at,
			updated_at: t.updated_at,
			url: ticketUrl(base, id)
		},
		messages,
		permissions: { can_reply: auth.token.canReply }
	});
};

/** PATCH /api/v1/tickets/:id  { "status": "open" | "pending" | "closed" } (needs reply permission) */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const auth = requireAuth(locals);
	if (auth instanceof Response) return auth;
	if (!auth.token.canReply) return v1Error(403, 'This token is read-only');
	const rl = limited(auth.token, 'write', 20, 60);
	if (rl) return rl;
	const loaded = loadScopedTicket(auth, params.id);
	if (!loaded.ok) return loaded.response;

	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return v1Error(415, 'Content-Type must be application/json');
	}
	const body = (await request.json().catch(() => null)) as { status?: string } | null;
	const status = body?.status;
	if (status !== 'open' && status !== 'pending' && status !== 'closed') {
		return v1Error(400, 'status must be open, pending or closed');
	}

	// Only an admin may reopen a closed ticket (an agent acting for a user may not).
	if (loaded.ticket.status === 'closed' && status !== 'closed' && auth.user.role !== 'admin') {
		return v1Error(403, 'Only an administrator can reopen a closed ticket.');
	}

	setTicketStatus(loaded.id, status);
	broadcast(loaded.id, 'edit', { id: loaded.id });
	audit('ticket.status_changed', {
		actor: auth.user,
		target: `ticket:${loaded.id}`,
		detail: { status, via: `token:${auth.token.id}` }
	});
	return v1Json({ ok: true, status });
};
