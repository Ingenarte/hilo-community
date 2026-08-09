/**
 * Tickets — core CRUD, queries, access control, followers.
 *
 * Split from the 737-LOC monolith into four sibling modules:
 *   - `tickets.ts`            (this file)  → ticket rows, queries, access
 *   - `tickets-messages.ts`                → message timeline + reactions
 *   - `tickets-projects.ts`                → projects + ticket↔project links
 *   - `tickets-admin.ts`                   → admin users, templates, webhooks
 *
 * Existing callers keep importing from `'$lib/server/tickets'` — every
 * symbol moved out is re-exported at the bottom of this file, so the
 * refactor is transparent to the rest of the codebase.
 */

import { db } from './db';
import type { DBTicket, TicketPriority, TicketStatus } from './db';
import { getProjectNamesByTicketIds, getTicketProjectNames } from './tickets-projects';

export type TicketRow = DBTicket & {
	user_email: string;
	projects: string[];
	last_message_at: number;
	message_count: number;
	unread_count: number;
	// Sprint43: read-receipt eye icon (admin-only UI)
	// unix epoch of the admin's latest non-internal reply, or null when none exists.
	latest_admin_reply_at: number | null;
	// unix epoch of when the ticket owner last read the thread, or null when never read.
	owner_last_read_at: number | null;
};

export type TicketsQuery = {
	userId?: number; // omit for admin (all users)
	userEmail?: string; // when set together with userId, also surface tickets where the user is a follower
	// Used only for the unread_count column. Independent of the visibility
	// scope so admins still see every ticket but can have their own unread
	// counters on each row.
	unreadForUserId?: number;
	// Controls whether internal messages are included in the per-ticket
	// unread_count. Admins see internal messages; regular users do not.
	// Defaults to 'user' (safe fallback — no internal messages counted).
	unreadForRole?: 'user' | 'admin';
	search?: string; // matches title + message bodies via FTS5 (with LIKE fallback)
	status?: TicketStatus | 'any';
	priority?: TicketPriority | 'any';
	projectId?: number;
	assignedTo?: number | 'unassigned'; // admin filter
	includeArchived?: boolean;
	limit?: number;
	offset?: number;
};

export type TicketsPage = {
	tickets: TicketRow[];
	total: number;
	hasMore: boolean;
};

/**
 * Sanitises a free-text search query into an FTS5 expression. Strips the FTS
 * operators users would otherwise be able to inject (parens, quotes, NOT,
 * column filters) and converts each remaining token into a prefix match so
 * "hil" finds "hilo".
 */
function ftsQuery(s: string): string {
	const tokens = s
		.replace(/["()*:^]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 1)
		.slice(0, 6);
	if (tokens.length === 0) return '""';
	return tokens.map((t) => `"${t}"*`).join(' AND ');
}

/**
 * Single query path for both admin (all users) and user (own tickets), with
 * optional search / status / priority / project / pagination. KISS: one place
 * to debug ordering, indexes, and counts.
 */
export function queryTickets(q: TicketsQuery = {}): TicketsPage {
	const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
	const offset = Math.max(q.offset ?? 0, 0);
	const where: string[] = [];
	const params: Record<string, unknown> = {};

	if (q.userId !== undefined) {
		// A non-admin user sees a ticket when ANY of these is true:
		//   - they own it (tickets.user_id)
		//   - they are the explicit assignee (tickets.assigned_to)
		//   - they appear in ticket_followers by email
		//   - they belong to the ticket's group (tickets.group_id ∈ group_users)
		const sharedClauses = [
			't.user_id = $userId',
			't.assigned_to = $userId',
			`(t.group_id IS NOT NULL AND EXISTS (
			  SELECT 1 FROM group_users gu
			  WHERE gu.group_id = t.group_id AND gu.user_id = $userId))`
		];
		if (q.userEmail) {
			sharedClauses.push(
				`EXISTS (SELECT 1 FROM ticket_followers tf
				         WHERE tf.ticket_id = t.id AND tf.email = $userEmail COLLATE NOCASE)`
			);
			params.userEmail = q.userEmail;
		}
		where.push(`(${sharedClauses.join(' OR ')})`);
		params.userId = q.userId;
	}
	if (q.status && q.status !== 'any') {
		where.push('t.status = $status');
		params.status = q.status;
	}
	if (q.priority && q.priority !== 'any') {
		where.push('t.priority = $priority');
		params.priority = q.priority;
	}
	if (q.projectId !== undefined) {
		where.push(
			'EXISTS (SELECT 1 FROM ticket_projects tp WHERE tp.ticket_id = t.id AND tp.project_id = $projectId)'
		);
		params.projectId = q.projectId;
	}
	if (q.assignedTo === 'unassigned') {
		where.push('t.assigned_to IS NULL');
	} else if (q.assignedTo !== undefined) {
		where.push('t.assigned_to = $assignedTo');
		params.assignedTo = q.assignedTo;
	}
	if (!q.includeArchived) {
		where.push('t.archived_at IS NULL');
	}
	if (q.search && q.search.trim()) {
		where.push(
			`(t.title LIKE $likeSearch COLLATE NOCASE
			  OR t.id IN (SELECT ticket_id FROM messages_fts WHERE messages_fts MATCH $ftsSearch))`
		);
		params.likeSearch = `%${q.search.trim()}%`;
		params.ftsSearch = ftsQuery(q.search.trim());
	}
	const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

	const total = (
		db.prepare(`SELECT COUNT(*) AS n FROM tickets t ${whereClause}`).get(params) as { n: number }
	).n;

	// Sprint D: every ticket row also carries the unread count for the
	// querying user. q.unreadForUserId is the user the count is computed
	// against; it's independent of q.userId so admins (who don't pass
	// userId, because they see everything) can still pass their own id
	// here and get per-row badges.
	const unreadUid = q.unreadForUserId ?? q.userId;
	if (unreadUid !== undefined) params.unreadUid = unreadUid;
	// Sprint-40jun: unreadForRole controls whether internal messages are
	// counted. Admins pass 'admin' so their per-ticket badge matches the
	// navbar total (which already uses AND ($role = 'admin' OR m.internal = 0)).
	const unreadRole = q.unreadForRole ?? 'user';
	if (unreadUid !== undefined) params.unreadRole = unreadRole;
	const unreadCorrelated = unreadUid
		? `(SELECT COUNT(*)
		    FROM messages m2
		    LEFT JOIN ticket_reads r2 ON r2.ticket_id = t.id AND r2.user_id = $unreadUid
		    WHERE m2.ticket_id = t.id
		      AND m2.deleted_at IS NULL
		      AND m2.sender_id != $unreadUid
		      AND m2.created_at > COALESCE(r2.last_read_at, 0)
		      AND ($unreadRole = 'admin' OR m2.internal = 0))`
		: '0';
	const rows = db
		.prepare(
			`SELECT t.*, u.email AS user_email,
			        (SELECT COUNT(*) FROM messages m WHERE m.ticket_id = t.id) AS message_count,
			        (SELECT MAX(created_at) FROM messages m WHERE m.ticket_id = t.id) AS last_message_at,
			        ${unreadCorrelated} AS unread_count,
			        (SELECT MAX(m.created_at) FROM messages m
			         WHERE m.ticket_id = t.id
			           AND m.sender_role = 'admin'
			           AND m.internal = 0
			           AND m.deleted_at IS NULL) AS latest_admin_reply_at,
			        (SELECT r.last_read_at FROM ticket_reads r
			         WHERE r.ticket_id = t.id AND r.user_id = t.user_id) AS owner_last_read_at
			 FROM tickets t JOIN users u ON u.id = t.user_id
			 ${whereClause}
			 ORDER BY
			   CASE t.priority
			     WHEN 'urgent' THEN 0
			     WHEN 'high'   THEN 1
			     WHEN 'normal' THEN 2
			     WHEN 'low'    THEN 3
			   END,
			   COALESCE(
			     (SELECT MAX(created_at) FROM messages m WHERE m.ticket_id = t.id),
			     t.updated_at
			   ) DESC
			 LIMIT $limit OFFSET $offset`
		)
		.all({ ...params, limit, offset }) as Array<
		TicketRow & { last_message_at: number | null; unread_count: number }
	>;

	// Project names: batched in one query keyed by ticket id, avoiding the
	// N+1 loop that previously fired one SELECT per ticket row.
	const projectsByTicket = getProjectNamesByTicketIds(rows.map((r) => r.id));
	const tickets = rows.map((r) => ({
		...r,
		last_message_at: r.last_message_at ?? r.updated_at,
		projects: projectsByTicket.get(r.id) ?? []
	}));

	return { tickets, total, hasMore: offset + tickets.length < total };
}

export function listTicketsForUser(userId: number): TicketRow[] {
	return queryTickets({ userId, limit: 100 }).tickets;
}
export function listAllTickets(): TicketRow[] {
	return queryTickets({ limit: 100 }).tickets;
}

export function getTicket(ticketId: number): (DBTicket & { user_email: string }) | null {
	const row = db
		.prepare(
			`SELECT t.*, u.email AS user_email FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?`
		)
		.get(ticketId) as (DBTicket & { user_email: string }) | undefined;
	return row ?? null;
}

export function createTicket(args: {
	userId: number;
	title: string;
	projectIds: number[];
	groupId?: number | null;
}): number {
	const info = db
		.prepare('INSERT INTO tickets (user_id, title, group_id) VALUES (?, ?, ?)')
		.run(args.userId, args.title.slice(0, 200), args.groupId ?? null);
	const ticketId = Number(info.lastInsertRowid);
	const linkStmt = db.prepare(
		'INSERT OR IGNORE INTO ticket_projects (ticket_id, project_id) VALUES (?, ?)'
	);
	for (const pid of args.projectIds) linkStmt.run(ticketId, pid);
	return ticketId;
}

export function setTicketAssignment(ticketId: number, adminUserId: number | null): void {
	db.prepare('UPDATE tickets SET assigned_to = ?, updated_at = unixepoch() WHERE id = ?').run(
		adminUserId,
		ticketId
	);
}

export function setTicketGroup(ticketId: number, groupId: number | null): void {
	db.prepare('UPDATE tickets SET group_id = ?, updated_at = unixepoch() WHERE id = ?').run(
		groupId,
		ticketId
	);
}

export function setTicketArchived(ticketId: number, archived: boolean): void {
	const v = archived ? Math.floor(Date.now() / 1000) : null;
	db.prepare('UPDATE tickets SET archived_at = ?, updated_at = unixepoch() WHERE id = ?').run(
		v,
		ticketId
	);
}

export function setTicketStatus(ticketId: number, status: TicketStatus): void {
	db.prepare('UPDATE tickets SET status = ?, updated_at = unixepoch() WHERE id = ?').run(
		status,
		ticketId
	);
}

export function setTicketPriority(ticketId: number, priority: TicketPriority): void {
	db.prepare('UPDATE tickets SET priority = ?, updated_at = unixepoch() WHERE id = ?').run(
		priority,
		ticketId
	);
}

// ─── Access control + participants ──────────────────────────────────────────

export type Participant = {
	email: string;
	user_id: number | null;
	role: 'owner' | 'member' | 'admin';
};

/**
 * Authoritative check: does this user have access to this ticket?
 *   - admin: yes, always
 *   - owner: yes
 *   - participant: yes, when their email is in ticket_followers
 */
export function canAccessTicket(
	user: { id: number; email: string; role: 'user' | 'admin' },
	ticket: { id: number; user_id: number; assigned_to?: number | null; group_id?: number | null }
): boolean {
	if (user.role === 'admin') return true;
	if (ticket.user_id === user.id) return true;
	if (ticket.assigned_to === user.id) return true;
	const followerRow = db
		.prepare('SELECT 1 FROM ticket_followers WHERE ticket_id = ? AND email = ? COLLATE NOCASE')
		.get(ticket.id, user.email);
	if (followerRow) return true;
	if (ticket.group_id) {
		const groupRow = db
			.prepare('SELECT 1 FROM group_users WHERE group_id = ? AND user_id = ?')
			.get(ticket.group_id, user.id);
		if (groupRow) return true;
	}
	return false;
}

/**
 * Owner + every follower, with the matching user_id when the follower has
 * a Hilo account. Used by email fan-out and the sidebar UI.
 */
export function getTicketParticipants(ticketId: number): Participant[] {
	const ticket = db
		.prepare(
			`SELECT t.user_id, u.email FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?`
		)
		.get(ticketId) as { user_id: number; email: string } | undefined;
	if (!ticket) return [];

	const participants: Participant[] = [
		{ email: ticket.email, user_id: ticket.user_id, role: 'owner' }
	];

	const followers = db
		.prepare(
			`SELECT tf.email, u.id AS user_id, u.role AS user_role
			 FROM ticket_followers tf
			 LEFT JOIN users u ON u.email = tf.email COLLATE NOCASE
			 WHERE tf.ticket_id = ?
			 ORDER BY tf.email`
		)
		.all(ticketId) as Array<{ email: string; user_id: number | null; user_role: string | null }>;

	for (const f of followers) {
		participants.push({
			email: f.email,
			user_id: f.user_id,
			role: f.user_role === 'admin' ? 'admin' : 'member'
		});
	}

	// Sprint C: members of the ticket's group also receive notifications.
	// We deduplicate against the already-collected participant emails so
	// the owner / follower entries keep their original role.
	const seen = new Set(participants.map((p) => p.email.toLowerCase()));
	const groupMembers = db
		.prepare(
			`SELECT u.id AS user_id, u.email, u.role
			 FROM users u
			 JOIN group_users gu ON gu.user_id = u.id
			 JOIN tickets t ON t.id = ?
			 WHERE gu.group_id = t.group_id
			   AND u.disabled_at IS NULL`
		)
		.all(ticketId) as Array<{ user_id: number; email: string; role: 'user' | 'admin' }>;
	for (const m of groupMembers) {
		const key = m.email.toLowerCase();
		if (seen.has(key)) continue;
		participants.push({
			email: m.email,
			user_id: m.user_id,
			role: m.role === 'admin' ? 'admin' : 'member'
		});
		seen.add(key);
	}

	return participants;
}

// ─── Followers ──────────────────────────────────────────────────────────────

export function listFollowers(ticketId: number): string[] {
	return (
		db
			.prepare('SELECT email FROM ticket_followers WHERE ticket_id = ? ORDER BY email')
			.all(ticketId) as Array<{ email: string }>
	).map((r) => r.email);
}

export function addFollower(args: {
	ticketId: number;
	email: string;
	addedBy: number;
}): boolean {
	const email = args.email.toLowerCase().trim();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
	try {
		db.prepare(
			'INSERT INTO ticket_followers (ticket_id, email, added_by) VALUES (?, ?, ?)'
		).run(args.ticketId, email, args.addedBy);
		return true;
	} catch {
		// PK conflict → already a follower; treat as success.
		return true;
	}
}

export function removeFollower(ticketId: number, email: string): void {
	db.prepare(
		'DELETE FROM ticket_followers WHERE ticket_id = ? AND email = ? COLLATE NOCASE'
	).run(ticketId, email.toLowerCase().trim());
}

// ─── Re-exports (transparent re-organisation) ───────────────────────────────
//
// Every caller used to import from `'$lib/server/tickets'`. Moving the
// implementations out would have meant touching 30+ files. Instead we
// re-export here so the surface stays identical.

export {
	getMessagesForTicket,
	appendMessage,
	addAttachment,
	getAttachment,
	editMessage,
	softDeleteMessage,
	toggleReaction,
	getMessageTicketId
} from './tickets-messages';
export type { MessageRow, MessageView, RepliedToPreview } from './tickets-messages';

export {
	getTicketProjects,
	getTicketProjectNames,
	resolveProjectNames,
	listProjects,
	listProjectsForUser,
	listProjectsWithCounts,
	createProject,
	renameProject,
	deleteProject,
	mergeProjects,
	setTicketProjects
} from './tickets-projects';

export {
	getAdminUser,
	listAdmins,
	listAssignableForTicket,
	promoteUserToAdmin,
	demoteAdmin,
	listTemplates,
	createTemplate,
	deleteTemplate,
	listWebhooks,
	createWebhook,
	deleteWebhook,
	setWebhookEnabled
} from './tickets-admin';
