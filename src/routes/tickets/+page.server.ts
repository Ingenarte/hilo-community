import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listProjects, queryTickets } from '$lib/server/tickets';
import { getOpenTasksByTicketForUser } from '$lib/server/tasks';
import { db } from '$lib/server/db';
import type { TicketPriority, TicketStatus } from '$lib/server/db';

// 'active' (the default) hides closed tickets; 'any' shows everything, closed included.
const STATUSES: ReadonlyArray<TicketStatus | 'any' | 'active'> = ['active', 'any', 'open', 'pending', 'closed'];
const PRIORITIES: ReadonlyArray<TicketPriority | 'any'> = ['any', 'urgent', 'high', 'normal', 'low'];

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');
	const isAdmin = locals.user.role === 'admin';

	const search = url.searchParams.get('q')?.slice(0, 200) ?? '';
	const statusParam = url.searchParams.get('status');
	const status = (statusParam ?? 'active') as TicketStatus | 'any' | 'active';
	const priority = (url.searchParams.get('priority') ?? 'any') as TicketPriority | 'any';
	const projectIdRaw = url.searchParams.get('project');
	const projectId = projectIdRaw ? Number(projectIdRaw) : undefined;
	const showArchived = url.searchParams.get('archived') === '1';
	// Filter by ticket author: admins only (everyone else already sees just their own and shared tickets).
	const ownerRaw = Number(url.searchParams.get('user'));
	const ownerId = isAdmin && Number.isInteger(ownerRaw) && ownerRaw > 0 ? ownerRaw : undefined;
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
	const perPage = 25;

	let safeStatus = STATUSES.includes(status) ? status : 'active';
	// Text search looks through every status unless one was chosen on purpose.
	const statusDefault = !statusParam || !STATUSES.includes(status);
	if (statusDefault && search.trim()) safeStatus = 'any';
	const safePriority = PRIORITIES.includes(priority) ? priority : 'any';

	const result = queryTickets({
		userId: isAdmin ? undefined : locals.user.id,
		userEmail: isAdmin ? undefined : locals.user.email,
		unreadForUserId: locals.user.id,
		unreadForRole: isAdmin ? 'admin' : 'user',
		search,
		status: safeStatus,
		priority: safePriority,
		projectId: projectId && Number.isFinite(projectId) ? projectId : undefined,
		ownerId,
		includeArchived: showArchived,
		limit: perPage,
		offset: (page - 1) * perPage
	});

	// Batched: open tasks assigned to the viewer, keyed by ticket id.
	// Used to render the "Pending task" amber chip + stripe on each row.
	const openTasksByTicket = getOpenTasksByTicketForUser(
		locals.user.id,
		result.tickets.map((t) => t.id)
	);
	const myTasksByTicket: Record<
		number,
		Array<{ id: number; title: string; description: string }>
	> = {};
	for (const [id, list] of openTasksByTicket) myTasksByTicket[id] = list;

	return {
		isAdmin,
		tickets: result.tickets,
		myTasksByTicket,
		total: result.total,
		page,
		perPage,
		hasMore: result.hasMore,
		projects: listProjects(),
		// Authors of tickets, for the admin's "All users" filter.
		users: isAdmin
			? (db
					.prepare(
						`SELECT u.id, u.email FROM users u
						 WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.user_id = u.id)
						 ORDER BY u.email COLLATE NOCASE`
					)
					.all() as Array<{ id: number; email: string }>)
			: [],
		filters: {
			search,
			status: safeStatus,
			statusDefault,
			priority: safePriority,
			projectId: projectId ?? null,
			userId: ownerId ?? null,
			archived: showArchived
		}
	};
};
