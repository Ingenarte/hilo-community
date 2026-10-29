import { createHash } from 'node:crypto';
import { log } from './logger';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const DEFAULT_TIMEOUT_MS = 2500;

type Options = { fetchImpl?: typeof fetch; timeoutMs?: number };

/**
 * Breached-password screening with the Have I Been Pwned range API
 * (k-anonymity: only the first 5 hex chars of the SHA-1 leave the server, the
 * password never does). Fails open: an outage, a slow response or any error
 * must never block a password change, and the wait is bounded by `timeoutMs`
 * even if the fetch implementation ignores abort signals.
 */
export async function checkPwnedPassword(password: string, opts: Options = {}): Promise<boolean> {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
	const prefix = sha1.slice(0, 5);
	const suffix = sha1.slice(5);

	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<'timeout'>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve('timeout');
		}, timeoutMs);
	});

	try {
		const request = (async () => {
			const res = await fetchImpl(`${RANGE_URL}${prefix}`, {
				headers: { 'Add-Padding': 'true', 'User-Agent': 'hilo-password-check' },
				signal: controller.signal
			});
			if (!res.ok) return false;
			const body = await res.text();
			for (const line of body.split('\n')) {
				const [hash, count] = line.trim().split(':');
				if (hash === suffix && Number(count) > 0) return true;
			}
			return false;
		})();
		// A late rejection after the timeout must not become an unhandled rejection.
		request.catch(() => undefined);
		const result = await Promise.race([request, timedOut]);
		if (result === 'timeout') {
			log.warn('pwned check timed out, allowing password', { timeout_ms: timeoutMs });
			return false;
		}
		return result;
	} catch (err) {
		log.warn('pwned check unavailable, allowing password', {
			err: err instanceof Error ? err.message : String(err)
		});
		return false;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** Off with PWNED_PASSWORDS_CHECK=0 and always under tests. */
export async function isPwnedPassword(password: string): Promise<boolean> {
	if (process.env.PWNED_PASSWORDS_CHECK === '0' || process.env.VITEST) return false;
	return checkPwnedPassword(password);
}
