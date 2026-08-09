/**
 * Aggregation queries that derive each user's primary device + display
 * mode + OS from their session history.
 *
 * Sessions store one row per login event with a captured user_agent and
 * derived device_class / display_mode / os_hint. To decide which device
 * a user "uses most", we count sessions whose `last_seen` falls within
 * a rolling window (default 30 days) and group by device class.
 *
 * The "dominant" device is whichever class accounts for STRICTLY more
 * than 50% of the windowed sessions. A 50/50 split returns `null` —
 * neither dominates, so the UI shows both chips at equal weight.
 *
 * A single-device user (100% mobile, say) is implicitly dominant.
 */

import { db } from './db';

const WINDOW_SECS_DEFAULT = 30 * 24 * 60 * 60; // 30 days

export type DeviceCounts = {
	mobile: number;
	tablet: number;
	desktop: number;
};

export type UserDeviceStats = {
	userId: number;
	totalSessions: number;
	counts: DeviceCounts;
	/** The class with > 50% share, or null if no class dominates (or no sessions). */
	dominant: 'mobile' | 'tablet' | 'desktop' | null;
	/** True if the user has at least one session launched from the installed PWA. */
	usesPwa: boolean;
	/** Most common OS in the window, or null. */
	topOs: string | null;
	/** Timestamp (unix) of the most recent session, or null. */
	latestSeen: number | null;
};

function pickDominant(counts: DeviceCounts): UserDeviceStats['dominant'] {
	const total = counts.mobile + counts.tablet + counts.desktop;
	if (total === 0) return null;
	if (counts.mobile / total > 0.5) return 'mobile';
	if (counts.tablet / total > 0.5) return 'tablet';
	if (counts.desktop / total > 0.5) return 'desktop';
	return null;
}

/**
 * Stats for a single user. Used by per-row drawers and per-user pages.
 */
export function getUserDeviceStats(
	userId: number,
	windowSecs: number = WINDOW_SECS_DEFAULT
): UserDeviceStats {
	const cutoff = Math.floor(Date.now() / 1000) - windowSecs;
	const rows = db
		.prepare(
			`SELECT device_class, display_mode, os_hint, last_seen
			 FROM sessions
			 WHERE user_id = ? AND last_seen >= ?`
		)
		.all(userId, cutoff) as Array<{
		device_class: string | null;
		display_mode: string | null;
		os_hint: string | null;
		last_seen: number;
	}>;

	const counts: DeviceCounts = { mobile: 0, tablet: 0, desktop: 0 };
	const osTally = new Map<string, number>();
	let usesPwa = false;
	let latestSeen: number | null = null;
	for (const r of rows) {
		// Sessions created before the migration have null device_class —
		// treat them as 'desktop' to avoid skewing the picture (rare).
		const cls = (r.device_class as keyof DeviceCounts) ?? 'desktop';
		if (cls === 'mobile' || cls === 'tablet' || cls === 'desktop') counts[cls] += 1;
		if (r.display_mode === 'pwa') usesPwa = true;
		if (r.os_hint) osTally.set(r.os_hint, (osTally.get(r.os_hint) ?? 0) + 1);
		if (latestSeen == null || r.last_seen > latestSeen) latestSeen = r.last_seen;
	}

	const topOs =
		[...osTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

	return {
		userId,
		totalSessions: rows.length,
		counts,
		dominant: pickDominant(counts),
		usesPwa,
		topOs,
		latestSeen
	};
}

/**
 * Batch version — one query for many users, used by /admin/users to
 * avoid an N+1. Returns a Map keyed by userId; users with no sessions
 * in the window get a stats object with `totalSessions: 0`.
 */
export function getUserDeviceStatsBatch(
	userIds: number[],
	windowSecs: number = WINDOW_SECS_DEFAULT
): Map<number, UserDeviceStats> {
	const result = new Map<number, UserDeviceStats>();
	for (const id of userIds) {
		result.set(id, {
			userId: id,
			totalSessions: 0,
			counts: { mobile: 0, tablet: 0, desktop: 0 },
			dominant: null,
			usesPwa: false,
			topOs: null,
			latestSeen: null
		});
	}
	if (userIds.length === 0) return result;

	const cutoff = Math.floor(Date.now() / 1000) - windowSecs;
	const placeholders = userIds.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`SELECT user_id, device_class, display_mode, os_hint, last_seen
			 FROM sessions
			 WHERE user_id IN (${placeholders}) AND last_seen >= ?`
		)
		.all(...userIds, cutoff) as Array<{
		user_id: number;
		device_class: string | null;
		display_mode: string | null;
		os_hint: string | null;
		last_seen: number;
	}>;

	const osTallies = new Map<number, Map<string, number>>();
	for (const r of rows) {
		const stats = result.get(r.user_id);
		if (!stats) continue;
		const cls = (r.device_class as keyof DeviceCounts) ?? 'desktop';
		if (cls === 'mobile' || cls === 'tablet' || cls === 'desktop') stats.counts[cls] += 1;
		stats.totalSessions += 1;
		if (r.display_mode === 'pwa') stats.usesPwa = true;
		if (r.os_hint) {
			let tally = osTallies.get(r.user_id);
			if (!tally) {
				tally = new Map();
				osTallies.set(r.user_id, tally);
			}
			tally.set(r.os_hint, (tally.get(r.os_hint) ?? 0) + 1);
		}
		if (stats.latestSeen == null || r.last_seen > stats.latestSeen) {
			stats.latestSeen = r.last_seen;
		}
	}

	for (const stats of result.values()) {
		stats.dominant = pickDominant(stats.counts);
		const tally = osTallies.get(stats.userId);
		if (tally) {
			stats.topOs = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
		}
	}

	return result;
}

/**
 * Returns the set of user IDs in {userIds} that have at least one streak of
 * 3 consecutive calendar days of activity within the trailing 7 days, all
 * from the same device_class.
 *
 * Uses a window-function CTE with LAG to detect when the 3rd day in a run
 * is exactly 2 Julian days ahead of the 1st — i.e. three consecutive dates.
 *
 * SQLite >= 3.25 is required for LAG; all modern SQLite builds qualify.
 */
export function getStreakUserIdsBatch(userIds: number[]): Set<number> {
	if (userIds.length === 0) return new Set();

	const placeholders = userIds.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`WITH dates AS (
			  SELECT DISTINCT
			    user_id,
			    DATE(datetime(last_seen, 'unixepoch')) AS d,
			    device_class
			  FROM sessions
			  WHERE user_id IN (${placeholders})
			    AND last_seen >= unixepoch() - 7 * 86400
			    AND device_class IS NOT NULL
			),
			windowed AS (
			  SELECT
			    user_id, d, device_class,
			    LAG(d, 2) OVER (PARTITION BY user_id, device_class ORDER BY d) AS d0
			  FROM dates
			)
			SELECT DISTINCT user_id FROM windowed
			WHERE julianday(d) - julianday(d0) = 2`
		)
		.all(...userIds) as Array<{ user_id: number }>;

	return new Set(rows.map((r) => r.user_id));
}
