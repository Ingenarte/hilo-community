/**
 * Messages, attachments, and reactions.
 *
 * One responsibility per file: this one owns the message timeline
 * (`messages` + `attachments` + `reactions` tables). Ticket-level metadata
 * lives in `tickets.ts`; project tagging in `tickets-projects.ts`.
 */

import { db } from './db';
import type { DBAttachment, DBMessage } from './db';
import { prepareRenditionInBackground } from './audioRendition';
import { checkSilenceInBackground } from './audioSilence';
import { DEFAULT_PRIORITY, isPriority, slaSeconds, type Priority } from '../sla';

export type MessageRow = DBMessage & {
	sender_email: string;
	attachments: DBAttachment[];
};

/** A quoted preview of the message being replied to. */
export type RepliedToPreview = {
	id: number;
	/** First 80 chars of the original message body. */
	body: string;
	sender_email: string;
};

export type MessageView = MessageRow & {
	reactions: Array<{ emoji: string; count: number; mine: boolean }>;
	/** Present only when this message is a reply to another. */
	replied_to: RepliedToPreview | null;
};

export function getMessagesForTicket(
	ticketId: number,
	viewer: { id: number; role: 'user' | 'admin' }
): MessageView[] {
	// Non-admin viewers never see internal notes.
	const internalClause = viewer.role === 'admin' ? '' : 'AND m.internal = 0';
	const rows = db
		.prepare(
			`SELECT m.*, u.email AS sender_email,
			        rm.id         AS replied_to_id,
			        rm.body       AS replied_to_body,
			        ru.email      AS replied_to_sender_email
			 FROM messages m
			 JOIN users u ON u.id = m.sender_id
			 LEFT JOIN messages rm ON rm.id = m.replied_to_message_id AND rm.deleted_at IS NULL
			 LEFT JOIN users ru ON ru.id = rm.sender_id
			 WHERE m.ticket_id = ? ${internalClause} AND m.deleted_at IS NULL
			 ORDER BY m.created_at ASC, m.id ASC`
		)
		.all(ticketId) as Array<
		DBMessage & {
			sender_email: string;
			replied_to_id: number | null;
			replied_to_body: string | null;
			replied_to_sender_email: string | null;
		}
	>;

	// Batch-fetch attachments and reactions for every message in one
	// query each, then group in memory. Previously this function ran
	// (rows.length × 2) extra queries — a 50-message thread was 101
	// SQLite calls. With batching it is 3 calls regardless of size.
	const messageIds = rows.map((r) => r.id);
	const attachmentsByMessage = new Map<number, DBAttachment[]>();
	const reactionsByMessage = new Map<
		number,
		Array<{ emoji: string; count: number; mine: boolean }>
	>();
	if (messageIds.length > 0) {
		const placeholders = messageIds.map(() => '?').join(', ');
		const attRows = db
			.prepare(
				`SELECT * FROM attachments
				 WHERE message_id IN (${placeholders})
				 ORDER BY message_id, id`
			)
			.all(...messageIds) as DBAttachment[];
		for (const att of attRows) {
			const list = attachmentsByMessage.get(att.message_id);
			if (list) list.push(att);
			else attachmentsByMessage.set(att.message_id, [att]);
		}

		const reactRows = db
			.prepare(
				`SELECT message_id, emoji,
				        COUNT(*) AS count,
				        SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
				 FROM reactions
				 WHERE message_id IN (${placeholders})
				 GROUP BY message_id, emoji
				 ORDER BY message_id, emoji`
			)
			.all(viewer.id, ...messageIds) as Array<{
			message_id: number;
			emoji: string;
			count: number;
			mine: number;
		}>;
		for (const r of reactRows) {
			const item = { emoji: r.emoji, count: r.count, mine: r.mine > 0 };
			const list = reactionsByMessage.get(r.message_id);
			if (list) list.push(item);
			else reactionsByMessage.set(r.message_id, [item]);
		}
	}

	return rows.map((r) => ({
		...r,
		attachments: attachmentsByMessage.get(r.id) ?? [],
		reactions: reactionsByMessage.get(r.id) ?? [],
		replied_to:
			r.replied_to_id != null
				? {
						id: r.replied_to_id,
						body: (r.replied_to_body ?? '').slice(0, 80),
						sender_email: r.replied_to_sender_email ?? ''
					}
				: null
	}));
}

/**
 * Restart the response-time target from now: due = now + hours(priority).
 * Called on every public message and when a ticket is reopened.
 */
export function restartResponseTarget(ticketId: number): void {
	const row = db.prepare('SELECT priority FROM tickets WHERE id = ?').get(ticketId) as
		| { priority: Priority }
		| undefined;
	if (!row) return;
	db.prepare('UPDATE tickets SET sla_due_at = unixepoch() + ? WHERE id = ?').run(
		slaSeconds(isPriority(row.priority) ? row.priority : DEFAULT_PRIORITY),
		ticketId
	);
}

/** A user tried to write in a closed ticket: only an admin may, and only an admin can reopen it. */
export class TicketClosedError extends Error {
	constructor(public ticketId: number) {
		super(`Ticket #${ticketId} is closed.`);
		this.name = 'TicketClosedError';
	}
}

export const TICKET_CLOSED_MESSAGE =
	'This ticket is closed. Only an administrator can reopen it. If you need something else, open a new ticket.';

export function appendMessage(args: {
	ticketId: number;
	senderId: number;
	senderRole: 'user' | 'admin';
	body: string;
	internal?: boolean;
	repliedToMessageId?: number | null;
	/** Set when an agent posts through an API token (shown as an agent message). */
	viaTokenId?: number | null;
}): number {
	const internal = args.internal ? 1 : 0;

	// Closed tickets take no new messages from users (admins may still write).
	if (args.senderRole === 'user') {
		const st = db.prepare('SELECT status FROM tickets WHERE id = ?').get(args.ticketId) as
			| { status: string }
			| undefined;
		if (st?.status === 'closed') throw new TicketClosedError(args.ticketId);
	}

	// Defensive: if a reply target is provided, verify it belongs to the same
	// ticket and is not deleted. FK enforcement falls to application code because
	// SQLite ALTER TABLE ADD COLUMN does not support REFERENCES.
	if (args.repliedToMessageId != null) {
		const exists = db
			.prepare(
				'SELECT 1 FROM messages WHERE id = ? AND ticket_id = ? AND deleted_at IS NULL'
			)
			.get(args.repliedToMessageId, args.ticketId);
		if (!exists) {
			throw new Error('Invalid repliedToMessageId: not found in this ticket or already deleted');
		}
	}

	const info = db
		.prepare(
			`INSERT INTO messages
			   (ticket_id, sender_id, sender_role, body, internal, replied_to_message_id, via_token_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			args.ticketId,
			args.senderId,
			args.senderRole,
			args.body,
			internal,
			args.repliedToMessageId ?? null,
			args.viaTokenId ?? null
		);
	db.prepare('UPDATE tickets SET updated_at = unixepoch() WHERE id = ?').run(args.ticketId);
	// Every public message, from either side, restarts the response target.
	// Internal notes are admin-only and do not.
	if (!args.internal) restartResponseTarget(args.ticketId);
	return Number(info.lastInsertRowid);
}

export function addAttachment(args: {
	messageId: number;
	filename: string;
	storedName: string;
	mimeType: string;
	sizeBytes: number;
}): number {
	const info = db
		.prepare(
			'INSERT INTO attachments (message_id, filename, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)'
		)
		.run(args.messageId, args.filename, args.storedName, args.mimeType, args.sizeBytes);
	// WebM/Ogg voice messages also get an AAC rendition (plays on iPhone), and
	// empty recordings are flagged so the chat can say so.
	const attachmentId = Number(info.lastInsertRowid);
	prepareRenditionInBackground(args.storedName, args.mimeType);
	checkSilenceInBackground(attachmentId, args.storedName, args.mimeType);
	return attachmentId;
}

export function getAttachment(id: number): DBAttachment | null {
	return (
		(db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as DBAttachment | undefined) ??
		null
	);
}

/** Closed tickets are frozen for users: no new, edited or deleted messages. */
export function isTicketClosed(ticketId: number): boolean {
	const r = db.prepare('SELECT status FROM tickets WHERE id = ?').get(ticketId) as
		| { status: string }
		| undefined;
	return r?.status === 'closed';
}

export function editMessage(args: {
	messageId: number;
	body: string;
	by: { id: number; role: 'user' | 'admin' };
}): boolean {
	const row = db
		.prepare('SELECT ticket_id, sender_id, deleted_at FROM messages WHERE id = ?')
		.get(args.messageId) as
		| { ticket_id: number; sender_id: number; deleted_at: number | null }
		| undefined;
	if (!row) return false;
	if (row.deleted_at) return false;
	if (args.by.role !== 'admin' && row.sender_id !== args.by.id) return false;
	if (args.by.role !== 'admin' && isTicketClosed(row.ticket_id)) return false;
	const newBody = args.body.slice(0, 16_000);
	db.prepare('UPDATE messages SET body = ?, edited_at = unixepoch() WHERE id = ?').run(
		newBody,
		args.messageId
	);
	return true;
}

export function softDeleteMessage(args: {
	messageId: number;
	by: { id: number; role: 'user' | 'admin' };
}): boolean {
	const row = db
		.prepare('SELECT sender_id, ticket_id FROM messages WHERE id = ?')
		.get(args.messageId) as { sender_id: number; ticket_id: number } | undefined;
	if (!row) return false;
	if (args.by.role !== 'admin' && row.sender_id !== args.by.id) return false;
	if (args.by.role !== 'admin' && isTicketClosed(row.ticket_id)) return false;
	// Soft-delete: keep the row so reply threading and audit don't break,
	// but blank the body and stamp deleted_at so the UI shows a tombstone.
	db.prepare("UPDATE messages SET body = '', deleted_at = unixepoch() WHERE id = ?").run(
		args.messageId
	);
	return true;
}

export function toggleReaction(
	messageId: number,
	userId: number,
	emoji: string
): 'added' | 'removed' {
	const existing = db
		.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
		.get(messageId, userId, emoji);
	if (existing) {
		db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(
			messageId,
			userId,
			emoji
		);
		return 'removed';
	}
	db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(
		messageId,
		userId,
		emoji
	);
	return 'added';
}

export function getMessageTicketId(messageId: number): number | null {
	const row = db.prepare('SELECT ticket_id FROM messages WHERE id = ?').get(messageId) as
		| { ticket_id: number }
		| undefined;
	return row?.ticket_id ?? null;
}
