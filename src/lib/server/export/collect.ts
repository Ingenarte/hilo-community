import { existsSync } from 'node:fs';
import { getMessagesForTicket, getTicket, getTicketProjects } from '../tickets';
import { getStorage } from '../storage';
import { assetPathFor, attachmentKind } from './names';
import type { ExportTicket } from './types';

/**
 * Loads a ticket for export. Callers must already have verified that the
 * viewer can access it. Internal notes are included only for admins and
 * deleted messages never are (both enforced by getMessagesForTicket).
 */
export function collectTicket(
	ticketId: number,
	viewer: { id: number; role: 'user' | 'admin' }
): ExportTicket | null {
	const t = getTicket(ticketId);
	if (!t) return null;
	const storage = getStorage();
	let assetIndex = 0;

	const messages = getMessagesForTicket(ticketId, viewer).map((m) => ({
		id: m.id,
		created_at: m.created_at,
		who: m.sender_role === 'admin' ? 'Admin' : m.sender_email,
		internal: m.internal === 1,
		edited: !!m.edited_at,
		body: m.body,
		attachments: m.attachments.map((a) => {
			assetIndex += 1;
			return {
				id: a.id,
				filename: a.filename,
				mime_type: a.mime_type,
				size_bytes: a.size_bytes,
				stored_name: a.stored_name,
				kind: attachmentKind(a.mime_type),
				transcript_text: a.transcript_status === 'ready' ? a.transcript_text : null,
				transcript_lang: a.transcript_lang,
				assetPath: assetPathFor(assetIndex, a),
				missing: !existsSync(storage.pathOf(a.stored_name))
			};
		})
	}));

	return {
		id: t.id,
		title: t.title,
		owner: t.user_email,
		status: t.status,
		priority: t.priority,
		priorityReason: t.priority_reason,
		slaDueAt: t.sla_due_at,
		createdAt: t.created_at,
		updatedAt: t.updated_at,
		projects: getTicketProjects(ticketId).map((p) => p.name),
		messages
	};
}
