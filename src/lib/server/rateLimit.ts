/**
 * SQLite-backed rate limiter. Persists counters across container restarts
 * so brute-force windows survive `docker compose restart`.
 *
 * Design:
 *   - Each key maps to one row (INSERT OR REPLACE).
 *   - On every hit, if the window has expired the row is reset; otherwise
 *     count is incremented atomically via a single UPDATE.
 *   - Stale rows are lazily cleaned up on every hit (DELETE WHERE window
 *     older than max(2x the window, CLEANUP_RETENTION_SECONDS) — avoids table bloat
 *     without requiring a separate cron).
 *
 * Falls back to the legacy in-memory map if db is unavailable (import
 * errors in tests that run outside the full SvelteKit runtime).
 */

import { db } from './db';
import { log } from './logger';

/** Rows are kept at least this long; must exceed 2x the longest window in use. */
const CLEANUP_RETENTION_SECONDS = 2 * 86400;

export type RateLimitResult = {
	ok: boolean;
	remaining: number;
	retryAfterSeconds: number;
};

// Prepared statements — initialised lazily so import never fails in
// unit-test environments where db might be stubbed.
// Use named parameters (:key, :count, :window_start) to avoid the TS
// overload ambiguity when run() receives multiple positional args.
let _stmts: {
	get: ReturnType<typeof db.prepare>;
	reset: ReturnType<typeof db.prepare>;
	hit: ReturnType<typeof db.prepare>;
	cleanup: ReturnType<typeof db.prepare>;
} | null = null;

function getStmts() {
	if (!_stmts) {
		_stmts = {
			get: db.prepare(
				'SELECT count, window_start FROM rate_limits WHERE key = :key'
			),
			reset: db.prepare(
				'INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (:key, :count, :window_start)'
			),
			hit: db.prepare(
				'UPDATE rate_limits SET count = count + 1 WHERE key = :key'
			),
			cleanup: db.prepare(
				'DELETE FROM rate_limits WHERE window_start < :threshold'
			)
		};
	}
	return _stmts;
}

/**
 * Increment the counter for `key` within a sliding window of `windowSeconds`.
 * Returns `ok: false` when `maxRequests` is exceeded.
 *
 * This function is synchronous (SQLite is sync) and safe to call from any
 * SvelteKit server hook or endpoint.
 */
export function rateLimit(
	key: string,
	maxRequests: number,
	windowSeconds: number
): RateLimitResult {
	try {
		const stmts = getStmts();
		const now = Math.floor(Date.now() / 1000);

		// Lazy cleanup keeps the table from growing unbounded without a cron job.
		// The threshold must not depend on the caller's window: a 60 s limiter
		// would otherwise delete the rows of every 1 h limiter after 120 s and
		// silently reset their counters. Retain at least CLEANUP_RETENTION_SECONDS.
		stmts.cleanup.run({
			threshold: now - Math.max(windowSeconds * 2, CLEANUP_RETENTION_SECONDS)
		});

		const row = stmts.get.get({ key }) as
			| { count: number; window_start: number }
			| undefined;

		if (!row || now - row.window_start >= windowSeconds) {
			// No row or window expired — start a fresh window with count = 1.
			stmts.reset.run({ key, count: 1, window_start: now });
			return { ok: true, remaining: maxRequests - 1, retryAfterSeconds: 0 };
		}

		if (row.count >= maxRequests) {
			const retry = Math.max(1, windowSeconds - (now - row.window_start));
			return { ok: false, remaining: 0, retryAfterSeconds: retry };
		}

		stmts.hit.run({ key });
		return { ok: true, remaining: maxRequests - row.count - 1, retryAfterSeconds: 0 };
	} catch (err) {
		// If SQLite is unavailable (test env, cold-start race), fail open:
		// log the error and allow the request.
		log.error('rateLimit sqlite error — failing open', {
			key,
			err: err instanceof Error ? err.message : String(err)
		});
		return { ok: true, remaining: maxRequests, retryAfterSeconds: 0 };
	}
}

/**
 * Read-only look at a counter: has `key` already used up `maxRequests` in its
 * current window? Unlike `rateLimit` it never increments, so callers can check
 * a lockout first and only count the events that should count (e.g. failures).
 */
export function rateLimitStatus(
	key: string,
	maxRequests: number,
	windowSeconds: number
): { blocked: boolean; retryAfterSeconds: number } {
	try {
		const row = getStmts().get.get({ key }) as { count: number; window_start: number } | undefined;
		const now = Math.floor(Date.now() / 1000);
		if (!row || now - row.window_start >= windowSeconds || row.count < maxRequests) {
			return { blocked: false, retryAfterSeconds: 0 };
		}
		return {
			blocked: true,
			retryAfterSeconds: Math.max(1, windowSeconds - (now - row.window_start))
		};
	} catch {
		// Same fail-open policy as rateLimit().
		return { blocked: false, retryAfterSeconds: 0 };
	}
}

/** Forget a counter (e.g. wrong-password count after a successful sign-in). */
export function clearRateLimit(key: string): void {
	try {
		db.prepare('DELETE FROM rate_limits WHERE key = ?').run(key);
	} catch {
		// ignore
	}
}

/**
 * Best-effort client IP. Trusts `x-forwarded-for` first (set by Caddy/nginx),
 * then falls back to the socket peer. Returns `?` if neither is available.
 */
export function clientIp(headers: Headers, getClientAddress?: () => string): string {
	const xff = headers.get('x-forwarded-for');
	if (xff) return xff.split(',')[0].trim();
	try {
		return getClientAddress?.() ?? '?';
	} catch {
		return '?';
	}
}

/**
 * Reset a specific key (used by tests or admin tooling).
 */
export function _resetRateLimiter(key?: string): void {
	try {
		if (key) {
			db.prepare('DELETE FROM rate_limits WHERE key = ?').run(key);
		} else {
			db.exec('DELETE FROM rate_limits');
		}
	} catch {
		// ignore — tests may not have a DB
	}
}
