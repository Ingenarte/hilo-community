import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { config } from '$lib/server/env';
import { queryTickets } from '$lib/server/tickets';
import { isPriority } from '$lib/sla';
import { limited, requireAuth, ticketUrl, v1Error, v1Json } from '$lib/server/apiV1';

const STATUSES = ['open', 'pending', 'closed', 'any'] as const;
const SORTS = ['due', 'updated', 'created', 'id'] as const;
const DUES = ['overdue', '24h', 'none'] as const;

function parseSince(v: string | null): number | undefined | 'invalid' {
	if (!v) return undefined;
	if (/^\d+$/.test(v)) return Number(v);
	const ms = Date.parse(v);
	return Number.isNaN(ms) ? 'invalid' : Math.floor(ms / 1000);
}

function resolveUserId(v: string): number | null {
	const row = db
		.prepare('SELECT id FROM users WHERE id = ? OR email = ? COLLATE NOCASE')
		.get(/^\d+$/.test(v) ? Number(v) : -1, v) as { id: number } | undefined;
	return row?.id ?? null;
}

function resolveProjectId(v: string): number | null {
	const row = db
		.prepare(
			'SELECT id FROM projects WHERE id = ? OR slug = ? COLLATE NOCASE OR name = ? COLLATE NOCASE'
		)
		.get(/^\d+$/.test(v) ? Number(v) : -1, v, v) as { id: number } | undefined;
	return row?.id ?? null;
}

/**
 * GET /api/v1/tickets
 * Query: status=open|pending|closed|any (default open), project=<id|slug|name>,
 * owner=<id|email>, assignee=<id|email|unassigned>, group=<id>, priority=,
 * due=overdue|24h|none, q=, updated_since=, created_since= (ISO or unix),
 * has_attachments=1, archived=1 (include archived), sort=due|updated|created|id,
 * order=asc|desc, limit (<=100, default 25), offset.
 * Visibility is the token user's own; a ticket-scoped token sees only its ticket.
 */
export const GET: RequestHandler = ({ locals, url }) => {
	const auth = requireAuth(locals);
	if (auth instanceof Response) return auth;
	const rl = limited(auth.token, 'read', 120, 60);
	if (rl) return rl;

	const sp = url.searchParams;
	const status = sp.get('status') ?? 'open';
	if (!(STATUSES as readonly string[]).includes(status)) {
		return v1Error(400, 'status must be open, pending, closed or any');
	}
	const priority = sp.get('priority');
	if (priority && !isPriority(priority)) {
		return v1Error(400, 'priority must be urgent, high, normal or low');
	}
	const sort = sp.get('sort');
	if (sort && !(SORTS as readonly string[]).includes(sort)) {
		return v1Error(400, 'sort must be due, updated, created or id');
	}
	const due = sp.get('due');
	if (due && !(DUES as readonly string[]).includes(due)) {
		return v1Error(400, 'due must be overdue, 24h or none');
	}
	const order = sp.get('order');
	if (order && order !== 'asc' && order !== 'desc') return v1Error(400, 'order must be asc or desc');

	const updatedSince = parseSince(sp.get('updated_since'));
	const createdSince = parseSince(sp.get('created_since'));
	if (updatedSince === 'invalid' || createdSince === 'invalid') {
		return v1Error(400, 'updated_since / created_since must be an ISO date or unix seconds');
	}

	let projectId: number | undefined;
	if (sp.get('project')) {
		const id = resolveProjectId(sp.get('project')!);
		if (id === null) return v1Error(400, 'Unknown project');
		projectId = id;
	}
	let ownerId: number | undefined;
	if (sp.get('owner')) {
		const id = resolveUserId(sp.get('owner')!);
		if (id === null) return v1Error(400, 'Unknown owner');
		ownerId = id;
	}
	let assignedTo: number | 'unassigned' | undefined;
	if (sp.get('assignee') === 'unassigned') assignedTo = 'unassigned';
	else if (sp.get('assignee')) {
		const id = resolveUserId(sp.get('assignee')!);
		if (id === null) return v1Error(400, 'Unknown assignee');
		assignedTo = id;
	}
	const groupRaw = sp.get('group');
	if (groupRaw && !/^\d+$/.test(groupRaw)) return v1Error(400, 'group must be a numeric id');

	const limit = Math.min(Math.max(Number(sp.get('limit') ?? 25) || 25, 1), 100);
	const offset = Math.min(Math.max(Number(sp.get('offset') ?? 0) || 0, 0), 100000);
	const isAdmin = auth.user.role === 'admin';

	const result = queryTickets({
		userId: isAdmin ? undefined : auth.user.id,
		userEmail: isAdmin ? undefined : auth.user.email,
		unreadForUserId: auth.user.id,
		unreadForRole: isAdmin ? 'admin' : 'user',
		status: status as (typeof STATUSES)[number],
		priority: (priority as 'urgent' | 'high' | 'normal' | 'low' | null) ?? undefined,
		projectId,
		ownerId,
		assignedTo,
		groupId: groupRaw ? Number(groupRaw) : undefined,
		due: (due as (typeof DUES)[number] | null) ?? undefined,
		updatedSince: updatedSince as number | undefined,
		createdSince: createdSince as number | undefined,
		hasAttachments: sp.get('has_attachments') === '1',
		includeArchived: sp.get('archived') === '1',
		onlyTicketId: auth.token.ticketId ?? undefined,
		search: sp.get('q')?.slice(0, 200) ?? undefined,
		sort: (sort as (typeof SORTS)[number] | null) ?? undefined,
		sortReverse: order === (sort === 'due' || !sort ? 'desc' : 'asc'),
		limit,
		offset
	});

	const now = Math.floor(Date.now() / 1000);
	const base = config.publicBaseUrl;
	return v1Json({
		tickets: result.tickets.map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			priority: t.priority,
			priority_reason: t.priority_reason,
			sla_due_at: t.sla_due_at,
			sla_remaining_seconds: t.sla_due_at === null ? null : t.sla_due_at - now,
			owner: t.user_email,
			assigned_to: t.assigned_to,
			group_id: t.group_id,
			projects: t.projects,
			archived: t.archived_at !== null,
			message_count: t.message_count,
			unread_count: t.unread_count,
			last_message_at: t.last_message_at,
			created_at: t.created_at,
			updated_at: t.updated_at,
			url: ticketUrl(base, t.id)
		})),
		total: result.total,
		limit,
		offset,
		has_more: result.hasMore,
		next_offset: result.hasMore ? offset + limit : null
	});
};
