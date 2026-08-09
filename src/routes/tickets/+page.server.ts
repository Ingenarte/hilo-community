import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listProjects, queryTickets } from '$lib/server/tickets';
import { getOpenTasksByTicketForUser } from '$lib/server/tasks';
import type { TicketPriority, TicketStatus } from '$lib/server/db';

const STATUSES: ReadonlyArray<TicketStatus | 'any'> = ['any', 'open', 'pending', 'closed'];
const PRIORITIES: ReadonlyArray<TicketPriority | 'any'> = ['any', 'urgent', 'high', 'normal', 'low'];

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');
	const isAdmin = locals.user.role === 'admin';

	const search = url.searchParams.get('q')?.slice(0, 200) ?? '';
	const status = (url.searchParams.get('status') ?? 'any') as TicketStatus | 'any';
	const priority = (url.searchParams.get('priority') ?? 'any') as TicketPriority | 'any';
	const projectIdRaw = url.searchParams.get('project');
	const projectId = projectIdRaw ? Number(projectIdRaw) : undefined;
	const showArchived = url.searchParams.get('archived') === '1';
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
	const perPage = 25;

	const safeStatus = STATUSES.includes(status) ? status : 'any';
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
		filters: {
			search,
			status: safeStatus,
			priority: safePriority,
			projectId: projectId ?? null,
			archived: showArchived
		}
	};
};
