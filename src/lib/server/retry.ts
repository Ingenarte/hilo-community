/**
 * Generic retry helper with exponential backoff. KISS: no queue persistence,
 * no external dependency. If the process restarts mid-retry we drop the
 * pending attempt — acceptable trade-off for the spec's "simple" target.
 */

export type RetryOptions = {
	attempts?: number; // total attempts including the first one
	baseDelayMs?: number; // delay before the 2nd attempt
	maxDelayMs?: number;
	onError?: (err: unknown, attempt: number) => void;
};

const defaults: Required<Omit<RetryOptions, 'onError'>> = {
	attempts: 3,
	baseDelayMs: 2_000,
	maxDelayMs: 30_000
};

export async function withRetry<T>(
	work: () => Promise<T>,
	opts: RetryOptions = {}
): Promise<T> {
	const { attempts, baseDelayMs, maxDelayMs } = { ...defaults, ...opts };
	let lastErr: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return await work();
		} catch (err) {
			lastErr = err;
			opts.onError?.(err, i + 1);
			if (i === attempts - 1) break;
			const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, i));
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	throw lastErr;
}
