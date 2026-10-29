import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { checkPwnedPassword } from '../src/lib/server/pwned';
import { isTestAccount } from '../src/lib/server/testAccounts';

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase();
const respond = (body: string, ok = true) =>
	(async () => ({ ok, text: async () => body }) as Response) as unknown as typeof fetch;

describe('checkPwnedPassword', () => {
	it('flags a password whose hash suffix is in the range response', async () => {
		const h = sha1('hunter2hunter2');
		const body = `0000000000000000000000000000000000A:0\n${h.slice(5)}:42\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3`;
		expect(await checkPwnedPassword('hunter2hunter2', { fetchImpl: respond(body) })).toBe(true);
	});
	it('ignores padding entries with a zero count and non-matches', async () => {
		const h = sha1('correct horse battery');
		expect(
			await checkPwnedPassword('correct horse battery', { fetchImpl: respond(`${h.slice(5)}:0\nABC:5`) })
		).toBe(false);
	});
	it('sends only the 5-character prefix', async () => {
		let url = '';
		const spy = (async (u: string) => {
			url = u;
			return { ok: true, text: async () => '' } as Response;
		}) as unknown as typeof fetch;
		await checkPwnedPassword('another passphrase', { fetchImpl: spy });
		expect(url.endsWith(sha1('another passphrase').slice(0, 5))).toBe(true);
		expect(url).not.toContain(sha1('another passphrase').slice(5));
	});
	it('fails open on a non-OK response and on errors', async () => {
		expect(await checkPwnedPassword('x'.repeat(10), { fetchImpl: respond('', false) })).toBe(false);
		const boom = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect(await checkPwnedPassword('x'.repeat(10), { fetchImpl: boom })).toBe(false);
	});
	it('gives up after the timeout even when fetch ignores abort signals', async () => {
		const hang = (() => new Promise(() => undefined)) as unknown as typeof fetch;
		const t0 = Date.now();
		expect(await checkPwnedPassword('x'.repeat(10), { fetchImpl: hang, timeoutMs: 150 })).toBe(false);
		const took = Date.now() - t0;
		expect(took).toBeGreaterThanOrEqual(140);
		expect(took).toBeLessThan(1000);
	});
	it('gives up when fetch honours the abort signal', async () => {
		const abortable = ((_u: string, init: RequestInit) =>
			new Promise((_res, rej) => {
				init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
			})) as unknown as typeof fetch;
		expect(await checkPwnedPassword('x'.repeat(10), { fetchImpl: abortable, timeoutMs: 100 })).toBe(false);
	});
});

describe('isTestAccount', () => {
	it('matches the reserved test domain only', () => {
		expect(isTestAccount('e2e-pager@hilo.test')).toBe(true);
		expect(isTestAccount('E2E@HILO.TEST')).toBe(true);
		expect(isTestAccount('person@gmail.com')).toBe(false);
		expect(isTestAccount('person@hilo.test.evil.com')).toBe(false);
		expect(isTestAccount('hilo.test')).toBe(false);
		expect(isTestAccount('')).toBe(false);
		expect(isTestAccount(null)).toBe(false);
	});
});
