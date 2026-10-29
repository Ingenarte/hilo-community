import { describe, it, expect } from 'vitest';
import {
	TOKEN_PREFIX,
	TOKEN_TTL_SECONDS,
	generateToken,
	hashToken,
	isTokenUsable,
	parseBearer,
	tokenPrefix
} from '../src/lib/server/tokenCrypto';
import { buildAgentBrief } from '../src/lib/agentBrief';

describe('tokens', () => {
	it('lives 96 hours', () => {
		expect(TOKEN_TTL_SECONDS).toBe(96 * 3600);
	});

	it('generates unique, prefixed, URL-safe tokens', () => {
		const a = generateToken();
		const b = generateToken();
		expect(a).not.toBe(b);
		expect(a.startsWith(TOKEN_PREFIX)).toBe(true);
		expect(a).toMatch(/^hilo_[A-Za-z0-9_-]{43}$/);
	});

	it('hashes deterministically and never returns the token', () => {
		const t = generateToken();
		expect(hashToken(t)).toBe(hashToken(t));
		expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashToken(t)).not.toContain(t);
		expect(tokenPrefix(t)).toHaveLength(TOKEN_PREFIX.length + 6);
	});

	it('parses only well-formed Hilo bearer headers', () => {
		const t = generateToken();
		expect(parseBearer(`Bearer ${t}`)).toBe(t);
		expect(parseBearer(`bearer   ${t} `)).toBe(t);
		expect(parseBearer('Bearer abc')).toBeNull();
		expect(parseBearer(`Basic ${t}`)).toBeNull();
		expect(parseBearer(`Bearer ${t} extra`)).toBeNull();
		expect(parseBearer(`Bearer ${TOKEN_PREFIX}${'x'.repeat(300)}`)).toBeNull();
		expect(parseBearer(null)).toBeNull();
	});

	it('rejects expired and revoked tokens', () => {
		const now = 1_000_000;
		expect(isTokenUsable({ expires_at: now + 10, revoked_at: null }, now)).toBe(true);
		expect(isTokenUsable({ expires_at: now, revoked_at: null }, now)).toBe(false);
		expect(isTokenUsable({ expires_at: now - 1, revoked_at: null }, now)).toBe(false);
		expect(isTokenUsable({ expires_at: now + 10, revoked_at: now - 5 }, now)).toBe(false);
	});
});

describe('agent brief', () => {
	const base = { baseUrl: 'https://hilo.example.com/', token: 'hilo_TESTTOKEN', expiresAt: 1_800_000_000 };

	it('describes a ticket-scoped token with reply instructions', () => {
		const brief = buildAgentBrief({ ...base, ticketId: 319, canReply: true });
		expect(brief).toContain('ticket #319');
		expect(brief).toContain('hilo_TESTTOKEN');
		expect(brief).toContain('https://hilo.example.com/api/v1/tickets/319');
		expect(brief).toContain('/api/v1/tickets/319/messages');
		expect(brief).toContain('untrusted data');
		expect(brief).not.toContain('com//api');
	});

	it('omits write instructions for read-only tokens', () => {
		const brief = buildAgentBrief({ ...base, ticketId: 319, canReply: false });
		expect(brief).toContain('read-only');
		expect(brief).not.toContain('/messages');
		expect(brief).not.toContain('PATCH');
	});

	it('documents list filters for a general token', () => {
		const brief = buildAgentBrief({ ...base, ticketId: null, canReply: true });
		expect(brief).toContain('for all the tickets');
		expect(brief).toContain('due=overdue');
		expect(brief).toContain('<ticket id>');
	});
});
