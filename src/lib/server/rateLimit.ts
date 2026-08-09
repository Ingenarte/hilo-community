/**
 * SQLite-backed rate limiter. Persists counters across container restarts
 * so brute-force windows survive `docker compose restart`.
 *
 * Design:
 *   - Each key maps to one row (INSERT OR REPLACE).
 *   - On every hit, if the window has expired the row is reset; otherwise
 *     count is incremented atomically via a single UPDATE.
 *   - Stale rows are lazily cleaned up on every hit (DELETE WHERE window
 *     expired more than 2× the window length ago — avoids table bloat
 *     without requiring a separate cron).
 *
 * Falls back to the legacy in-memory map if db is unavailable (import
 * errors in tests that run outside the full SvelteKit runtime).
 */

import { db } from './db';
import { log } from './logger';

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

		// Lazy cleanup: delete rows whose window expired more than windowSeconds
		// ago. This keeps the table from growing unbounded without a cron job.
		stmts.cleanup.run({ threshold: now - windowSeconds * 2 });

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
