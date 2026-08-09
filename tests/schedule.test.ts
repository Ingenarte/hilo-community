import { describe, it, expect } from 'vitest';
import { isKnownSchedule, nextSendTime, SCHEDULES } from '../src/lib/server/schedule';

describe('isKnownSchedule', () => {
	it('accepts every preset key', () => {
		for (const p of SCHEDULES) expect(isKnownSchedule(p.key)).toBe(true);
	});

	it('accepts arbitrary IANA timezone strings', () => {
		expect(isKnownSchedule('Pacific/Auckland')).toBe(true);
		expect(isKnownSchedule('Europe/Paris')).toBe(true);
	});

	it('rejects nonsense', () => {
		expect(isKnownSchedule('Mars/Olympus')).toBe(false);
		expect(isKnownSchedule('')).toBe(false);
	});
});

describe('nextSendTime', () => {
	it('returns now for "immediate"', () => {
		const now = new Date('2026-05-22T03:00:00Z');
		const epoch = nextSendTime('immediate', now);
		expect(epoch).toBe(Math.floor(now.getTime() / 1000));
	});

	it('returns now when inside business hours (Berlin, Friday 14:00 local)', () => {
		// Friday 22 May 2026, 14:00 in Berlin = 12:00 UTC (no DST in Berlin
		// the choice doesn't matter; either way it's well within 9-18 local).
		const now = new Date('2026-05-22T12:00:00Z');
		const epoch = nextSendTime('europe-central', now);
		expect(epoch).toBe(Math.floor(now.getTime() / 1000));
	});

	it('queues until Monday 09:00 when fired on a Saturday', () => {
		// Saturday 23 May 2026, 14:00 UTC. In Berlin that's 16:00 Sat — still weekend.
		const now = new Date('2026-05-23T14:00:00Z');
		const epoch = nextSendTime('europe-central', now);
		const target = new Date(epoch * 1000);
		// Should be Monday morning. Format in Berlin TZ to verify.
		const fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: 'Europe/Berlin',
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
		const out = fmt.format(target);
		expect(out).toMatch(/Mon/);
		expect(out).toMatch(/09:00/);
	});

	it('queues until tomorrow 09:00 when fired after-hours on a weekday', () => {
		// Wednesday 20 May 2026, 22:00 UTC. In Tokyo that's Thursday 07:00.
		// In London (BST = UTC+1) that's Wed 23:00 → next business start is Thursday 09:00 London.
		const now = new Date('2026-05-20T22:00:00Z');
		const epoch = nextSendTime('europe-west', now);
		const fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: 'Europe/London',
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
		const out = fmt.format(new Date(epoch * 1000));
		expect(out).toMatch(/Thu/);
		expect(out).toMatch(/09:00/);
	});

	it('accepts a custom IANA timezone', () => {
		const now = new Date('2026-05-23T14:00:00Z'); // Saturday
		const epoch = nextSendTime('Pacific/Auckland', now);
		// Auckland is +12/+13; 14:00 UTC Sat = 02:00 Sun next day Auckland — still weekend.
		// Next business start = Monday 09:00 NZT.
		const fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: 'Pacific/Auckland',
			weekday: 'short',
			hour: '2-digit',
			hour12: false
		});
		const out = fmt.format(new Date(epoch * 1000));
		expect(out).toMatch(/Mon/);
		expect(out).toMatch(/09/);
	});
});
