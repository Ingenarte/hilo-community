import { describe, it, expect } from 'vitest';
import { loginUrlWithNext, maskEmail, safeNext } from '../src/lib/server/nav';
import { createMagicLink, consumeMagicLink, peekMagicLink } from '../src/lib/server/magic';
import { db } from '../src/lib/server/db';

describe('safeNext', () => {
	it('keeps same-site pages, with their query string', () => {
		expect(safeNext('/tickets/432')).toBe('/tickets/432');
		expect(safeNext('/tickets?status=closed&user=5')).toBe('/tickets?status=closed&user=5');
		expect(safeNext('/queue')).toBe('/queue');
	});
	it('refuses anything that could leave the site or loop through auth pages', () => {
		for (const bad of [
			'https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'tickets/1',
			'', null, undefined, '/login', '/login?next=/x', '/logout', '/m/abc', '/api/tickets', '/set-password?token=x',
			'/forgot-password', '/change-password', '/tickets\r\nSet-Cookie: a=b', '/a\\b', '/' + 'x'.repeat(600)
		]) {
			expect(safeNext(bad as string)).toBeNull();
		}
	});
	it('builds the login URL with the way back, or plain /login when unsafe', () => {
		expect(loginUrlWithNext('/tickets/12?x=1')).toBe('/login?next=%2Ftickets%2F12%3Fx%3D1');
		expect(loginUrlWithNext('/api/me')).toBe('/login');
	});
});

describe('maskEmail', () => {
	it('hides the local part', () => {
		expect(maskEmail('jane.doe@example.com')).toBe('j***@example.com');
		expect(maskEmail('nope')).toBe('***');
	});
});

describe('magic links', () => {
	function user() {
		db.prepare(`DELETE FROM users WHERE email = 'magic@hilo.test'`).run();
		return Number(db.prepare(`INSERT INTO users (email, role) VALUES ('magic@hilo.test','user')`).run().lastInsertRowid);
	}
	it('peeking does not use the link (a scanner opening it changes nothing)', () => {
		const u = user();
		const t = createMagicLink(u, null);
		expect(peekMagicLink(t)).toEqual({ user_id: u, ticket_id: null, usable: true });
		expect(peekMagicLink(t)?.usable).toBe(true);
		expect(consumeMagicLink(t)).toEqual({ user_id: u, ticket_id: null });
	});
	it('a spent or expired link stays readable so the destination survives', () => {
		const u = user();
		const t = createMagicLink(u, null);
		consumeMagicLink(t);
		expect(peekMagicLink(t)?.usable).toBe(false);
		expect(consumeMagicLink(t)).toBeNull();
		const t2 = createMagicLink(u, null);
		db.prepare('UPDATE magic_links SET expires_at = unixepoch() - 5 WHERE token = ?').run(t2);
		expect(peekMagicLink(t2)?.usable).toBe(false);
		expect(peekMagicLink('nonexistent')).toBeNull();
	});
});
