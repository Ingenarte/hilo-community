import { randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { db } from './db';
import { config } from './env';
import { PROD } from './utils';

import { error } from '@sveltejs/kit';

/** Operators can switch passkeys off with PASSKEYS_ENABLED=0. */
export function passkeysEnabled(): boolean {
	return process.env.PASSKEYS_ENABLED !== '0';
}

/** Endpoint guard: behaves as if the feature did not exist when disabled. */
export function assertPasskeysEnabled(): void {
	if (!passkeysEnabled()) throw error(404, 'Not found');
}

export const CHALLENGE_TTL_SECONDS = 300;
export const CHALLENGE_COOKIE = 'hilo_wa';
export const MAX_PASSKEYS_PER_USER = 10;

/**
 * Relying party. In production it is pinned to PUBLIC_BASE_URL (the app sits
 * behind a tunnel, so the request URL is not reliable); in development it
 * follows the host being used (localhost) so passkeys can be tried locally.
 */
export function relyingParty(url: URL): { rpID: string; origin: string; rpName: string } {
	if (PROD) {
		const base = new URL(config.publicBaseUrl);
		return { rpID: base.hostname, origin: base.origin, rpName: config.brand };
	}
	return { rpID: url.hostname, origin: url.origin, rpName: config.brand };
}

// ── Challenges ───────────────────────────────────────────────────────────────

export type ChallengePurpose = 'register' | 'login';

/** Stores a one-time challenge and returns the id to put in the cookie. */
export function storeChallenge(
	purpose: ChallengePurpose,
	challenge: string,
	userId: number | null
): string {
	const id = randomBytes(24).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(now);
	db.prepare(
		'INSERT INTO webauthn_challenges (id, purpose, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)'
	).run(id, purpose, userId, challenge, now + CHALLENGE_TTL_SECONDS);
	return id;
}

/** Returns the challenge and deletes it (single use). Null if missing, wrong purpose or expired. */
export function consumeChallenge(
	id: string | undefined,
	purpose: ChallengePurpose
): { challenge: string; userId: number | null } | null {
	if (!id) return null;
	return db.transaction(() => {
		const row = db
			.prepare('SELECT purpose, user_id, challenge, expires_at FROM webauthn_challenges WHERE id = ?')
			.get(id) as
			| { purpose: string; user_id: number | null; challenge: string; expires_at: number }
			| undefined;
		db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(id);
		if (!row || row.purpose !== purpose) return null;
		if (row.expires_at <= Math.floor(Date.now() / 1000)) return null;
		return { challenge: row.challenge, userId: row.user_id };
	})();
}

export function setChallengeCookie(cookies: Cookies, id: string): void {
	cookies.set(CHALLENGE_COOKIE, id, {
		path: '/api/passkeys',
		httpOnly: true,
		sameSite: 'strict',
		secure: PROD,
		maxAge: CHALLENGE_TTL_SECONDS
	});
}

export function clearChallengeCookie(cookies: Cookies): void {
	cookies.delete(CHALLENGE_COOKIE, { path: '/api/passkeys' });
}

// ── Credentials ──────────────────────────────────────────────────────────────

export type PasskeyRow = {
	id: number;
	user_id: number;
	credential_id: string;
	public_key: string;
	counter: number;
	transports: string | null;
	device_type: string;
	backed_up: number;
	name: string;
	created_at: number;
	last_used_at: number | null;
};

export type PasskeyView = Pick<PasskeyRow, 'id' | 'name' | 'created_at' | 'last_used_at'> & {
	synced: boolean;
};

/** Opaque per-user handle sent to authenticators (never PII). Created on first use. */
export function userHandle(userId: number): string {
	const row = db.prepare('SELECT webauthn_user_handle AS h FROM users WHERE id = ?').get(userId) as
		| { h: string | null }
		| undefined;
	if (row?.h) return row.h;
	const handle = randomBytes(32).toString('base64url');
	db.prepare('UPDATE users SET webauthn_user_handle = ? WHERE id = ? AND webauthn_user_handle IS NULL').run(
		handle,
		userId
	);
	const again = db.prepare('SELECT webauthn_user_handle AS h FROM users WHERE id = ?').get(userId) as {
		h: string;
	};
	return again.h;
}

export function listPasskeys(userId: number): PasskeyView[] {
	const rows = db
		.prepare(
			`SELECT id, name, created_at, last_used_at, backed_up FROM passkeys
			 WHERE user_id = ? ORDER BY created_at`
		)
		.all(userId) as Array<Pick<PasskeyRow, 'id' | 'name' | 'created_at' | 'last_used_at' | 'backed_up'>>;
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		created_at: r.created_at,
		last_used_at: r.last_used_at,
		synced: r.backed_up === 1
	}));
}

export function credentialsForUser(userId: number): Array<{ id: string; transports?: string[] }> {
	const rows = db
		.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?')
		.all(userId) as Array<{ credential_id: string; transports: string | null }>;
	return rows.map((r) => ({
		id: r.credential_id,
		transports: r.transports ? (JSON.parse(r.transports) as string[]) : undefined
	}));
}

export function countPasskeys(userId: number): number {
	return (db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(userId) as { n: number }).n;
}

export function findPasskey(credentialId: string): PasskeyRow | undefined {
	return db.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(credentialId) as
		| PasskeyRow
		| undefined;
}

export function addPasskey(p: {
	userId: number;
	credentialId: string;
	publicKey: string;
	counter: number;
	transports?: string[];
	deviceType: string;
	backedUp: boolean;
	name: string;
}): number {
	const info = db
		.prepare(
			`INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			p.userId,
			p.credentialId,
			p.publicKey,
			p.counter,
			p.transports ? JSON.stringify(p.transports) : null,
			p.deviceType,
			p.backedUp ? 1 : 0,
			p.name
		);
	return Number(info.lastInsertRowid);
}

export function touchPasskey(id: number, counter: number, backedUp: boolean): void {
	db.prepare('UPDATE passkeys SET counter = ?, backed_up = ?, last_used_at = unixepoch() WHERE id = ?').run(
		counter,
		backedUp ? 1 : 0,
		id
	);
}

export function deletePasskey(userId: number, id: number): boolean {
	return db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(id, userId).changes === 1;
}

export function renamePasskey(userId: number, id: number, name: string): boolean {
	return (
		db.prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId).changes === 1
	);
}

export function deleteAllPasskeys(userId: number): number {
	return db.prepare('DELETE FROM passkeys WHERE user_id = ?').run(userId).changes;
}

export function cleanName(raw: unknown): string {
	const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
	return name || 'Passkey';
}
