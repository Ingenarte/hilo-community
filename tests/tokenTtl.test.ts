import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { authenticateToken, tokenTtlChoices } from '../src/lib/server/apiTokens';
import {
	TOKEN_TTL_SECONDS,
	allowedTtlDays,
	parseMaxTtlDays,
	resolveTokenTtl
} from '../src/lib/server/tokenCrypto';
import { POST as createToken } from '../src/routes/api/tokens/+server';

describe('token lifetime rules', () => {
	it('parses API_TOKEN_MAX_TTL_DAYS with a safe default', () => {
		expect(parseMaxTtlDays(undefined)).toBe(365);
		expect(parseMaxTtlDays('')).toBe(365);
		expect(parseMaxTtlDays('abc')).toBe(365);
		expect(parseMaxTtlDays('-3')).toBe(365);
		expect(parseMaxTtlDays('90')).toBe(90);
		expect(parseMaxTtlDays('1')).toBe(4);
	});

	it('offers longer lifetimes to admins only, filtered by the cap', () => {
		expect(allowedTtlDays(false, 365)).toEqual([4]);
		expect(allowedTtlDays(true, 365)).toEqual([4, 30, 90, 365]);
		expect(allowedTtlDays(true, 90)).toEqual([4, 30, 90]);
		expect(allowedTtlDays(true, 4)).toEqual([4]);
	});

	it('resolves requested lifetimes to seconds', () => {
		expect(resolveTokenTtl(undefined, false, 365)).toEqual({ seconds: TOKEN_TTL_SECONDS });
		expect(resolveTokenTtl(null, true, 365)).toEqual({ seconds: TOKEN_TTL_SECONDS });
		expect(resolveTokenTtl(4, false, 365)).toEqual({ seconds: TOKEN_TTL_SECONDS });
		expect(resolveTokenTtl(365, true, 365)).toEqual({ seconds: 365 * 86400 });
		expect(resolveTokenTtl('30', true, 365)).toEqual({ seconds: 30 * 86400 });
		expect(resolveTokenTtl(30, false, 365)).toHaveProperty('error');
		expect(resolveTokenTtl(365, true, 90)).toHaveProperty('error');
		expect(resolveTokenTtl(7, true, 365)).toHaveProperty('error');
		expect(resolveTokenTtl(2.5, true, 365)).toHaveProperty('error');
	});
});

describe('POST /api/tokens with ttlDays', () => {
	const prevMax = process.env.API_TOKEN_MAX_TTL_DAYS;
	afterEach(() => {
		if (prevMax === undefined) delete process.env.API_TOKEN_MAX_TTL_DAYS;
		else process.env.API_TOKEN_MAX_TTL_DAYS = prevMax;
	});

	const mkUser = (role: 'user' | 'admin') => {
		const email = `ttl-${role}-${Math.random().toString(36).slice(2, 10)}@hilo.test`;
		const id = Number(db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(email, role).lastInsertRowid);
		return { id, email, role, theme: 'dark' as const, accent: 'violet' as const };
	};

	async function call(user: ReturnType<typeof mkUser>, payload: unknown) {
		const request = new Request('http://localhost/api/tokens', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		try {
			const res = (await createToken({
				locals: { user },
				request,
				url: new URL('http://localhost/api/tokens')
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any)) as Response;
			return { status: res.status, body: await res.json() };
		} catch (err) {
			const e = err as { status?: number; body?: { message?: string } };
			return { status: e.status ?? -1, body: e.body ?? {} };
		}
	}

	it('keeps 96 hours when ttlDays is omitted', async () => {
		const r = await call(mkUser('user'), {});
		expect(r.status).toBe(201);
		expect(r.body.info.expires_at - r.body.info.created_at).toBe(TOKEN_TTL_SECONDS);
	});

	it('lets an admin mint a 365 day token that authenticates', async () => {
		const r = await call(mkUser('admin'), { ttlDays: 365, canCreate: true });
		expect(r.status).toBe(201);
		expect(r.body.info.expires_at - r.body.info.created_at).toBe(365 * 86400);
		const auth = authenticateToken(r.body.token);
		expect(auth?.info.canCreate).toBe(true);
	});

	it('rejects a longer lifetime for non-admin users', async () => {
		const r = await call(mkUser('user'), { ttlDays: 30 });
		expect(r.status).toBe(400);
	});

	it('honours API_TOKEN_MAX_TTL_DAYS', async () => {
		process.env.API_TOKEN_MAX_TTL_DAYS = '30';
		expect(tokenTtlChoices(true)).toEqual([4, 30]);
		expect((await call(mkUser('admin'), { ttlDays: 90 })).status).toBe(400);
		expect((await call(mkUser('admin'), { ttlDays: 30 })).status).toBe(201);
	});
});
