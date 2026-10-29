import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { hashPassword, verifyPassword } from '../src/lib/server/password';
import {
	createPasswordToken,
	peekPasswordToken,
	redeemPasswordToken
} from '../src/lib/server/passwordTokens';
import { passwordGate } from '../src/lib/server/passwordGate';
import { validateNewPassword } from '../src/lib/passwordPolicy';

function makeUser(email: string): number {
	db.prepare('DELETE FROM users WHERE email = ?').run(email);
	return Number(
		db.prepare(`INSERT INTO users (email, role) VALUES (?, 'user')`).run(email).lastInsertRowid
	);
}

describe('password links', () => {
	let uid: number;
	beforeEach(() => {
		uid = makeUser('pwflow@hilo.test');
	});

	it('stores only a hash of the token', () => {
		const token = createPasswordToken(uid, 'welcome', 3600);
		expect(token.startsWith('hpw_')).toBe(true);
		const rows = db.prepare('SELECT token_hash FROM password_tokens WHERE user_id = ?').all(uid) as Array<{
			token_hash: string;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(rows[0].token_hash).not.toContain(token);
	});

	it('peeking does not spend the link', () => {
		const token = createPasswordToken(uid, 'reset', 3600);
		expect(peekPasswordToken(token)?.email).toBe('pwflow@hilo.test');
		expect(peekPasswordToken(token)).not.toBeNull();
	});

	it('works once, sets the password, clears the flag and revokes sessions', async () => {
		db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(uid);
		db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run('sess-pwflow', uid);
		const token = createPasswordToken(uid, 'reset', 3600);
		const hash = await hashPassword('correct horse battery');
		expect(redeemPasswordToken(token, hash)).toBe(uid);

		const row = db
			.prepare('SELECT password_hash, must_change_password, password_changed_at FROM users WHERE id = ?')
			.get(uid) as { password_hash: string; must_change_password: number; password_changed_at: number | null };
		expect(await verifyPassword('correct horse battery', row.password_hash)).toBe(true);
		expect(row.must_change_password).toBe(0);
		expect(row.password_changed_at).not.toBeNull();
		expect(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(uid)).toEqual({ n: 0 });

		// Second use fails and cannot overwrite the password.
		expect(redeemPasswordToken(token, await hashPassword('another password!'))).toBeNull();
		const again = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid) as { password_hash: string };
		expect(await verifyPassword('correct horse battery', again.password_hash)).toBe(true);
	});

	it('rejects expired links', async () => {
		const token = createPasswordToken(uid, 'reset', 3600);
		db.prepare('UPDATE password_tokens SET expires_at = unixepoch() - 5 WHERE user_id = ?').run(uid);
		expect(peekPasswordToken(token)).toBeNull();
		expect(redeemPasswordToken(token, await hashPassword('correct horse battery'))).toBeNull();
	});

	it('a newer link replaces the older one', () => {
		const first = createPasswordToken(uid, 'welcome', 3600);
		const second = createPasswordToken(uid, 'reset', 3600);
		expect(peekPasswordToken(first)).toBeNull();
		expect(peekPasswordToken(second)).not.toBeNull();
	});

	it('rejects disabled accounts and malformed tokens', () => {
		const token = createPasswordToken(uid, 'reset', 3600);
		db.prepare('UPDATE users SET disabled_at = unixepoch() WHERE id = ?').run(uid);
		expect(peekPasswordToken(token)).toBeNull();
		expect(peekPasswordToken('')).toBeNull();
		expect(peekPasswordToken('hpw_' + 'x'.repeat(200))).toBeNull();
		expect(peekPasswordToken('hilo_notapasswordtoken')).toBeNull();
	});
});

describe('password gate', () => {
	it('lets the forced screen, sign out and assets through', () => {
		for (const p of ['/change-password', '/set-password', '/logout', '/api/me/password', '/_app/immutable/x.js', '/favicon.svg', '/api/health']) {
			expect(passwordGate(p, p === '/change-password' || p === '/set-password' || p === '/logout' ? 'POST' : 'GET')).toBe('allow');
		}
	});
	it('redirects pages and blocks API calls', () => {
		expect(passwordGate('/tickets', 'GET')).toBe('redirect');
		expect(passwordGate('/preferences', 'GET')).toBe('redirect');
		expect(passwordGate('/api/tickets', 'GET')).toBe('block');
		expect(passwordGate('/tickets/1', 'POST')).toBe('block');
		expect(passwordGate('/api/attachments/5', 'GET')).toBe('block');
	});
});

describe('password policy', () => {
	it('accepts a passphrase and rejects weak choices', () => {
		expect(validateNewPassword('correct horse battery', 'a@b.co')).toBeNull();
		expect(validateNewPassword('short', 'a@b.co')).toBe('too_short');
		expect(validateNewPassword('Password123', 'a@b.co')).toBe('too_common');
		expect(validateNewPassword('password', 'a@b.co')).toBe('too_common');
		expect(validateNewPassword('12345678', 'a@b.co')).toBe('too_common');
		expect(validateNewPassword('aaaaaaaaaa', 'a@b.co')).toBe('repetitive');
		expect(validateNewPassword('x'.repeat(129), 'a@b.co')).toBe('too_long');
		expect(validateNewPassword('maria.lopez@x.com', 'maria.lopez@x.com')).toBe('contains_email');
		expect(validateNewPassword('mariaLopez2026', 'maria@x.com')).toBe('contains_email');
	});
});
