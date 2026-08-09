/**
 * Per-user read state on tickets. Backs the unread badges in the inbox
 * and the per-message "NEW" indicator in the ticket detail page.
 *
 * Rule for "is this message unread for user U?":
 *   m.sender_id != U.id
 *   AND m.deleted_at IS NULL
 *   AND m.created_at > coalesce(ticket_reads.last_read_at for (m.ticket_id, U.id), 0)
 *   AND (m.internal = 0 OR U.role = 'admin')
 *
 * Tickets the user has never opened (no ticket_reads row) implicitly have
 * last_read_at = 0, so every message in them is unread on first encounter.
 */
import { db } from './db';

export type UnreadByTicket = Map<number, number>;

/**
 * Number of distinct tickets that have at least one unread message for this user.
 * Used by the navbar badge so the number matches the count of `.unread-dot`
 * indicators rendered in `/tickets`. Bounded by the same visibility rules as
 * queryTickets (tickets the user cannot access are not counted).
 *
 * Note: only the layout server calls this function. No other caller expects
 * message-count semantics — confirmed by grep on 2026-06-07.
 */
export function getUnreadTotal(userId: number, userEmail: string, role: 'user' | 'admin'): number {
	const row = db
		.prepare(
			`SELECT COUNT(DISTINCT t.id) AS n FROM messages m
			 JOIN tickets t ON t.id = m.ticket_id
			 LEFT JOIN ticket_reads r ON r.ticket_id = t.id AND r.user_id = $userId
			 WHERE m.deleted_at IS NULL
			   AND m.sender_id != $userId
			   AND m.created_at > COALESCE(r.last_read_at, 0)
			   AND ($role = 'admin' OR m.internal = 0)
			   AND (
			       $role = 'admin'
			       OR t.user_id = $userId
			       OR t.assigned_to = $userId
			       OR (t.group_id IS NOT NULL AND EXISTS (
			           SELECT 1 FROM group_users gu
			           WHERE gu.group_id = t.group_id AND gu.user_id = $userId))
			       OR EXISTS (
			           SELECT 1 FROM ticket_followers tf
			           WHERE tf.ticket_id = t.id AND tf.email = $userEmail COLLATE NOCASE)
			   )`
		)
		.get({ userId, userEmail, role }) as { n: number };
	return row.n;
}

/**
 * Unread count per ticket id, only for tickets the user can see.
 * Returned as a Map keyed by ticket_id; tickets with zero unread are
 * omitted so callers can do `map.get(id) ?? 0`.
 */
export function getUnreadByTicket(
	userId: number,
	userEmail: string,
	role: 'user' | 'admin'
): UnreadByTicket {
	const rows = db
		.prepare(
			`SELECT m.ticket_id AS tid, COUNT(*) AS n
			 FROM messages m
			 JOIN tickets t ON t.id = m.ticket_id
			 LEFT JOIN ticket_reads r ON r.ticket_id = t.id AND r.user_id = $userId
			 WHERE m.deleted_at IS NULL
			   AND m.sender_id != $userId
			   AND m.created_at > COALESCE(r.last_read_at, 0)
			   AND ($role = 'admin' OR m.internal = 0)
			   AND (
			       $role = 'admin'
			       OR t.user_id = $userId
			       OR t.assigned_to = $userId
			       OR (t.group_id IS NOT NULL AND EXISTS (
			           SELECT 1 FROM group_users gu
			           WHERE gu.group_id = t.group_id AND gu.user_id = $userId))
			       OR EXISTS (
			           SELECT 1 FROM ticket_followers tf
			           WHERE tf.ticket_id = t.id AND tf.email = $userEmail COLLATE NOCASE)
			   )
			 GROUP BY m.ticket_id`
		)
		.all({ userId, userEmail, role }) as Array<{ tid: number; n: number }>;
	const out: UnreadByTicket = new Map();
	for (const r of rows) out.set(r.tid, r.n);
	return out;
}

/**
 * The user's last_read_at on a given ticket. 0 if never opened.
 * Used by /tickets/[id]'s load to decide which messages get the "NEW"
 * pill on this render (we read this BEFORE markTicketRead bumps it).
 */
export function getLastReadAt(ticketId: number, userId: number): number {
	const row = db
		.prepare('SELECT last_read_at FROM ticket_reads WHERE ticket_id = ? AND user_id = ?')
		.get(ticketId, userId) as { last_read_at: number } | undefined;
	return row?.last_read_at ?? 0;
}

/**
 * Mark a ticket as read by user up to `lastReadMsgId` (and its created_at).
 * Idempotent. Use the latest message's id + created_at on each call.
 */
export function markTicketRead(
	ticketId: number,
	userId: number,
	lastReadMsgId: number | null,
	lastReadAt: number
): void {
	db.prepare(
		`INSERT INTO ticket_reads (ticket_id, user_id, last_read_at, last_read_msg_id)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT (ticket_id, user_id) DO UPDATE
		   SET last_read_at = excluded.last_read_at,
		       last_read_msg_id = excluded.last_read_msg_id`
	).run(ticketId, userId, lastReadAt, lastReadMsgId);
}
