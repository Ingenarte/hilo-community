import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';
import {
	addPasskey,
	cleanName,
	consumeChallenge,
	countPasskeys,
	credentialsForUser,
	deleteAllPasskeys,
	deletePasskey,
	findPasskey,
	listPasskeys,
	renamePasskey,
	storeChallenge,
	touchPasskey,
	userHandle
} from '../src/lib/server/passkeys';

function makeUser(email: string): number {
	db.prepare('DELETE FROM users WHERE email = ?').run(email);
	return Number(db.prepare(`INSERT INTO users (email, role) VALUES (?, 'user')`).run(email).lastInsertRowid);
}

const key = (userId: number, credentialId: string) =>
	addPasskey({
		userId,
		credentialId,
		publicKey: 'cHVibGljLWtleQ',
		counter: 0,
		transports: ['internal'],
		deviceType: 'multiDevice',
		backedUp: true,
		name: 'Test phone'
	});

describe('webauthn challenges', () => {
	it('are single use', () => {
		const id = storeChallenge('login', 'abc', null);
		expect(consumeChallenge(id, 'login')?.challenge).toBe('abc');
		expect(consumeChallenge(id, 'login')).toBeNull();
	});
	it('are bound to their purpose and consumed even when it is wrong', () => {
		const id = storeChallenge('register', 'abc', 7);
		expect(consumeChallenge(id, 'login')).toBeNull();
		expect(consumeChallenge(id, 'register')).toBeNull();
	});
	it('expire and reject missing ids', () => {
		const id = storeChallenge('login', 'abc', null);
		db.prepare('UPDATE webauthn_challenges SET expires_at = unixepoch() - 1 WHERE id = ?').run(id);
		expect(consumeChallenge(id, 'login')).toBeNull();
		expect(consumeChallenge(undefined, 'login')).toBeNull();
		expect(consumeChallenge('nope', 'login')).toBeNull();
	});
	it('carry the user for registration', () => {
		const id = storeChallenge('register', 'xyz', 42);
		expect(consumeChallenge(id, 'register')).toEqual({ challenge: 'xyz', userId: 42 });
	});
});

describe('passkey store', () => {
	let uid: number;
	let other: number;
	beforeEach(() => {
		uid = makeUser('pk1@hilo.test');
		other = makeUser('pk2@hilo.test');
	});

	it('keeps a stable opaque user handle', () => {
		const h = userHandle(uid);
		expect(h).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(userHandle(uid)).toBe(h);
		expect(userHandle(other)).not.toBe(h);
		expect(h).not.toContain('pk1');
	});

	it('stores, lists and looks up credentials without exposing key material', () => {
		key(uid, 'cred-1');
		const list = listPasskeys(uid);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ name: 'Test phone', synced: true, last_used_at: null });
		expect(Object.keys(list[0])).not.toContain('public_key');
		expect(findPasskey('cred-1')?.user_id).toBe(uid);
		expect(credentialsForUser(uid)).toEqual([{ id: 'cred-1', transports: ['internal'] }]);
		expect(countPasskeys(uid)).toBe(1);
	});

	it('rejects a duplicate credential id', () => {
		key(uid, 'dup');
		expect(() => key(other, 'dup')).toThrow();
	});

	it('records usage', () => {
		const id = key(uid, 'cred-2');
		touchPasskey(id, 5, false);
		const row = findPasskey('cred-2')!;
		expect(row.counter).toBe(5);
		expect(row.backed_up).toBe(0);
		expect(row.last_used_at).not.toBeNull();
	});

	it('only the owner can rename or delete', () => {
		const id = key(uid, 'cred-3');
		expect(renamePasskey(other, id, 'x')).toBe(false);
		expect(deletePasskey(other, id)).toBe(false);
		expect(renamePasskey(uid, id, 'Renamed')).toBe(true);
		expect(listPasskeys(uid)[0].name).toBe('Renamed');
		expect(deletePasskey(uid, id)).toBe(true);
		expect(countPasskeys(uid)).toBe(0);
	});

	it('deleteAll removes only that user\'s passkeys', () => {
		key(uid, 'a1');
		key(uid, 'a2');
		key(other, 'b1');
		expect(deleteAllPasskeys(uid)).toBe(2);
		expect(countPasskeys(other)).toBe(1);
	});

	it('cleans names', () => {
		expect(cleanName('  My   iPhone  ')).toBe('My iPhone');
		expect(cleanName('')).toBe('Passkey');
		expect(cleanName(42)).toBe('Passkey');
		expect(cleanName('x'.repeat(100))).toHaveLength(60);
	});
});
