import type { SessionUser } from './auth';
import { listProjects, listProjectsForUser, queryTickets } from './tickets';

function positiveId(raw: string | null): number | undefined {
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Open tickets the viewer can see, soonest deadline first, plus the options
 * for the user and project filters. Shared by /queue and /gantt.
 * Visibility matches the inbox: admins see everything, users see their own
 * tickets plus the ones shared with them (assignee, group, follower).
 * Filters come from the URL: ?user=<owner id>&project=<project id>.
 */
export function loadOpenTicketsView(user: SessionUser, url: URL) {
	const isAdmin = user.role === 'admin';
	const ownerId = positiveId(url.searchParams.get('user'));
	const projectId = positiveId(url.searchParams.get('project'));

	const scope = {
		userId: isAdmin ? undefined : user.id,
		userEmail: isAdmin ? undefined : user.email,
		unreadForUserId: user.id,
		unreadForRole: isAdmin ? ('admin' as const) : ('user' as const),
		status: 'open' as const,
		sort: 'due' as const,
		limit: 100
	};

	const result = queryTickets({ ...scope, ownerId, projectId });

	// User options: owners of the open tickets the viewer can see, so the
	// picker never offers a user that would always yield an empty list.
	const visible = ownerId || projectId ? queryTickets(scope).tickets : result.tickets;
	const owners = new Map<number, string>();
	for (const t of visible) owners.set(t.user_id, t.user_email);
	const users = [...owners]
		.map(([id, email]) => ({ id, email }))
		.sort((a, b) => a.email.localeCompare(b.email));

	const projects = (isAdmin ? listProjects() : listProjectsForUser(user.id)).map((p) => ({
		id: p.id,
		name: p.name
	}));

	return {
		isAdmin,
		tickets: result.tickets,
		total: result.total,
		hasMore: result.hasMore,
		users,
		projects,
		filters: { userId: ownerId ?? null, projectId: projectId ?? null }
	};
}
