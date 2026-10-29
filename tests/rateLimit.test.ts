import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	_resetRateLimiter,
	clearRateLimit,
	clientIp,
	rateLimit,
	rateLimitStatus
} from '../src/lib/server/rateLimit';

describe('rateLimit', () => {
	beforeEach(() => _resetRateLimiter());

	it('allows up to N requests then blocks', () => {
		for (let i = 0; i < 5; i++) {
			const r = rateLimit('user:1', 5, 60);
			expect(r.ok).toBe(true);
		}
		const blocked = rateLimit('user:1', 5, 60);
		expect(blocked.ok).toBe(false);
		expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
	});

	it('isolates buckets by key', () => {
		for (let i = 0; i < 5; i++) rateLimit('user:1', 5, 60);
		const r = rateLimit('user:2', 5, 60);
		expect(r.ok).toBe(true);
	});

	it('returns remaining count', () => {
		const r = rateLimit('user:1', 3, 60);
		expect(r.remaining).toBe(2);
	});

	it('a short-window limiter does not reset a long-window counter', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			for (let i = 0; i < 3; i++) expect(rateLimit('hour:1', 3, 3600).ok).toBe(true);
			// Five minutes later a 60 s limiter runs its cleanup.
			vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
			rateLimit('minute:1', 3, 60);
			expect(rateLimit('hour:1', 3, 3600).ok).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('rateLimitStatus / clearRateLimit', () => {
	beforeEach(() => _resetRateLimiter());

	it('reports blocked only after the limit is used up, without counting', () => {
		for (let i = 0; i < 4; i++) rateLimit('fail:1', 5, 3600);
		expect(rateLimitStatus('fail:1', 5, 3600).blocked).toBe(false);
		// Looking must not consume the budget.
		for (let i = 0; i < 10; i++) rateLimitStatus('fail:1', 5, 3600);
		rateLimit('fail:1', 5, 3600);
		const st = rateLimitStatus('fail:1', 5, 3600);
		expect(st.blocked).toBe(true);
		expect(st.retryAfterSeconds).toBeGreaterThan(0);
	});

	it('is not blocked for an unknown key and unblocks after clear', () => {
		expect(rateLimitStatus('nope', 5, 3600).blocked).toBe(false);
		for (let i = 0; i < 5; i++) rateLimit('fail:2', 5, 3600);
		expect(rateLimitStatus('fail:2', 5, 3600).blocked).toBe(true);
		clearRateLimit('fail:2');
		expect(rateLimitStatus('fail:2', 5, 3600).blocked).toBe(false);
	});
});

describe('clientIp', () => {
	it('prefers X-Forwarded-For', () => {
		const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
		expect(clientIp(h)).toBe('1.2.3.4');
	});

	it('falls back to getClientAddress', () => {
		const h = new Headers();
		expect(clientIp(h, () => '9.9.9.9')).toBe('9.9.9.9');
	});

	it('returns ? when nothing is available', () => {
		const h = new Headers();
		expect(clientIp(h)).toBe('?');
	});
});
