import { describe, it, expect } from 'vitest';
import {
	SLA_HOURS,
	checkUrgentRequest,
	formatDuration,
	formatRemaining,
	isPriority,
	slaDueAt,
	slaTone
} from '../src/lib/sla';

describe('SLA targets', () => {
	it('maps each priority to its deadline in hours', () => {
		expect(SLA_HOURS).toEqual({ urgent: 24, high: 48, normal: 72, low: 96 });
	});

	it('computes the due date from the creation time', () => {
		expect(slaDueAt(1000, 'urgent')).toBe(1000 + 24 * 3600);
		expect(slaDueAt(1000, 'low')).toBe(1000 + 96 * 3600);
	});

	it('validates priorities', () => {
		expect(isPriority('urgent')).toBe(true);
		expect(isPriority('t1')).toBe(false);
		expect(isPriority(undefined)).toBe(false);
	});
});

describe('checkUrgentRequest', () => {
	it('requires an explicit confirmation', () => {
		expect(checkUrgentRequest('Customer is blocked in production', undefined).ok).toBe(false);
		expect(checkUrgentRequest('Customer is blocked in production', '0').ok).toBe(false);
	});

	it('requires a reason of at least 10 characters', () => {
		expect(checkUrgentRequest('too short', '1').ok).toBe(false);
		expect(checkUrgentRequest('   ', '1').ok).toBe(false);
		expect(checkUrgentRequest(undefined, '1').ok).toBe(false);
	});

	it('rejects absurdly long reasons', () => {
		expect(checkUrgentRequest('x'.repeat(501), '1').ok).toBe(false);
	});

	it('accepts and trims a valid request', () => {
		const r = checkUrgentRequest('  Payments are failing for all users  ', '1');
		expect(r).toEqual({ ok: true, reason: 'Payments are failing for all users' });
		expect(checkUrgentRequest('Payments are failing', true).ok).toBe(true);
	});
});

describe('remaining time formatting', () => {
	const now = 10_000;

	it('formats durations compactly', () => {
		expect(formatDuration(30)).toBe('<1m');
		expect(formatDuration(12 * 60)).toBe('12m');
		expect(formatDuration(5 * 3600 + 12 * 60)).toBe('5h 12m');
		expect(formatDuration(2 * 86400 + 5 * 3600)).toBe('2d 5h');
	});

	it('describes time left, overdue and missing deadlines', () => {
		expect(formatRemaining(now + 3 * 3600, now)).toBe('3h 0m left');
		expect(formatRemaining(now - 90 * 60, now)).toBe('Overdue 1h 30m');
		expect(formatRemaining(now, now)).toBe('Overdue <1m');
		expect(formatRemaining(null, now)).toBe('No deadline');
	});
});

describe('slaTone', () => {
	const total = 24 * 3600;
	const due = 100_000;

	it('escalates as the deadline approaches', () => {
		expect(slaTone(due, 'urgent', due - total * 0.8)).toBe('ok');
		expect(slaTone(due, 'urgent', due - total * 0.4)).toBe('warn');
		expect(slaTone(due, 'urgent', due - total * 0.1)).toBe('critical');
		expect(slaTone(due, 'urgent', due + 1)).toBe('overdue');
	});

	it('has no tone without a deadline', () => {
		expect(slaTone(null, 'normal', 0)).toBe('none');
	});
});
