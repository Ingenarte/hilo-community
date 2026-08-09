import { describe, it, expect, beforeEach } from 'vitest';
import { _resetRateLimiter, rateLimit, clientIp } from '../src/lib/server/rateLimit';

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
