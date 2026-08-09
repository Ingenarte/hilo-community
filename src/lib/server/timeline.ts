/**
 * Shared parser + cache for `TIMELINE_DEPLOY.md`.
 *
 * Used by `/api/timeline` (JSON for the navbar bell) and by the
 * `/changelog` page server-side loader. The markdown is inlined at
 * build time via Vite's `?raw` query so the runtime image does not
 * need the file on disk.
 */

import timelineMd from '../../../TIMELINE_DEPLOY.md?raw';

export type TimelineEntry = {
	/** Original YYYY-MM-DD string. */
	date: string;
	/** Unix seconds at 00:00 UTC of `date` — used for "have I seen this yet" math. */
	ts: number;
	/** Bullet lines under this date, in source order. */
	items: string[];
};

export type TimelinePayload = {
	entries: TimelineEntry[];
	latestTs: number;
};

const CACHE_TTL_MS = 60_000;
let cache: { expiresAt: number; payload: TimelinePayload } | null = null;

function parseDateUtc(s: string): number {
	const ms = Date.parse(s);
	if (Number.isNaN(ms)) return 0;
	return Math.floor(ms / 1000);
}

function parseTimeline(source: string): TimelineEntry[] {
	const entries: TimelineEntry[] = [];
	const lines = source.split(/\r?\n/);

	let current: TimelineEntry | null = null;
	let pendingBullet: string | null = null;

	function flushBullet() {
		if (!pendingBullet || !current) {
			pendingBullet = null;
			return;
		}
		current.items.push(pendingBullet.trim());
		pendingBullet = null;
	}

	for (const raw of lines) {
		const dateMatch = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(raw);
		if (dateMatch) {
			flushBullet();
			if (current) entries.push(current);
			current = { date: dateMatch[1], ts: parseDateUtc(dateMatch[1]), items: [] };
			continue;
		}
		if (!current) continue;

		// Some other `## …` heading (e.g. "How to add an entry") — close
		// the current entry and stop collecting until the next date.
		if (/^##\s+/.test(raw)) {
			flushBullet();
			entries.push(current);
			current = null;
			continue;
		}

		const bulletStart = /^\s*-\s+(.*)$/.exec(raw);
		if (bulletStart) {
			flushBullet();
			pendingBullet = bulletStart[1];
			continue;
		}

		// Indented continuation of the previous bullet — collapse the line break.
		if (pendingBullet != null && raw.trim() !== '' && /^\s{2,}/.test(raw)) {
			pendingBullet += ' ' + raw.trim();
			continue;
		}

		// Blank line closes any pending bullet so the next one starts fresh.
		if (raw.trim() === '') {
			flushBullet();
			continue;
		}
	}
	flushBullet();
	if (current) entries.push(current);

	return entries.filter((e) => e.items.length > 0);
}

export function loadTimeline(): TimelinePayload {
	const now = Date.now();
	if (cache && cache.expiresAt > now) return cache.payload;
	const entries = parseTimeline(timelineMd);
	const payload: TimelinePayload = { entries, latestTs: entries[0]?.ts ?? 0 };
	cache = { expiresAt: now + CACHE_TTL_MS, payload };
	return payload;
}
