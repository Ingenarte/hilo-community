import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/lib/server/retry';

describe('withRetry', () => {
	it('returns the first successful result', async () => {
		const fn = vi.fn().mockResolvedValueOnce('ok');
		const out = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
		expect(out).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries until success', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error('boom'))
			.mockRejectedValueOnce(new Error('still boom'))
			.mockResolvedValueOnce('eventually');
		const out = await withRetry(fn, { attempts: 5, baseDelayMs: 1, maxDelayMs: 2 });
		expect(out).toBe('eventually');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('gives up after N attempts and rethrows', async () => {
		const err = new Error('nope');
		const fn = vi.fn().mockRejectedValue(err);
		await expect(
			withRetry(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 })
		).rejects.toThrow('nope');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('calls onError with attempt number', async () => {
		const onError = vi.fn();
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error('1'))
			.mockResolvedValueOnce('ok');
		await withRetry(fn, { attempts: 3, baseDelayMs: 1, onError });
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][1]).toBe(1);
	});
});
