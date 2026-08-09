import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
	getUserDeviceStatsBatch,
	getStreakUserIdsBatch,
	type UserDeviceStats
} from '$lib/server/users-devices';

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const q = (url.searchParams.get('q') ?? '').trim();
	const params: Record<string, unknown> = { limit: 200 };
	let where = '';
	if (q) {
		where = 'WHERE email LIKE $like COLLATE NOCASE';
		params.like = `%${q}%`;
	}
	const users = db
		.prepare(
			`SELECT id, email, role, theme, accent, email_schedule, disabled_at,
			        created_at, last_seen,
			        (SELECT COUNT(*) FROM tickets WHERE user_id = users.id) AS ticket_count
			 FROM users ${where}
			 ORDER BY created_at DESC LIMIT $limit`
		)
		.all(params) as Array<{
		id: number;
		email: string;
		role: 'user' | 'admin';
		theme: string;
		accent: string;
		email_schedule: string;
		disabled_at: number | null;
		created_at: number;
		last_seen: number | null;
		ticket_count: number;
	}>;

	const userIds = users.map((u) => u.id);

	// One batched query for every user's last-30d device fingerprint.
	const deviceStats = getUserDeviceStatsBatch(userIds);
	// Serialise the Map for JSON transport — Svelte's load contract wants
	// plain values. Keep it keyed by id so the page can look up O(1).
	const devicesByUserId: Record<number, UserDeviceStats> = {};
	for (const [id, stats] of deviceStats) devicesByUserId[id] = stats;

	// Streak: users with 3 consecutive calendar days from the same device_class.
	// Serialised as an array of IDs (Set is not JSON-serialisable).
	const streakUserIds = [...getStreakUserIdsBatch(userIds)];

	return { users, q, devicesByUserId, currentUserId: locals.user.id, streakUserIds };
};
