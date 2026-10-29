import { randomBytes } from 'node:crypto';
import { db } from './db';
import { config } from './env';
import { hashToken } from './tokenCrypto';

/**
 * One-time "choose your password" links. Emailed instead of a password:
 *  - welcome: a new account (valid 7 days, the invite may sit unread)
 *  - reset:   admin reset or self-service forgot-password
 * Only the SHA-256 of the token is stored; a link works once and expires; a
 * newer link replaces every older unused one for that user.
 */
export type PasswordTokenPurpose = 'welcome' | 'reset';

export const WELCOME_TTL_SECONDS = 7 * 24 * 3600;
export const ADMIN_RESET_TTL_SECONDS = 24 * 3600;
export const SELF_RESET_TTL_SECONDS = 3600;

const TOKEN_PREFIX = 'hpw_';

export function createPasswordToken(
	userId: number,
	purpose: PasswordTokenPurpose,
	ttlSeconds: number
): string {
	const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	db.transaction(() => {
		db.prepare('DELETE FROM password_tokens WHERE user_id = ? AND used_at IS NULL').run(userId);
		// Housekeeping: drop rows that are long expired or used.
		db.prepare('DELETE FROM password_tokens WHERE expires_at < ?').run(now - 86400);
		db.prepare(
			`INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at)
			 VALUES (?, ?, ?, ?)`
		).run(userId, hashToken(token), purpose, now + ttlSeconds);
	})();
	return token;
}

export function passwordLinkUrl(token: string): string {
	return `${config.publicBaseUrl.replace(/\/+$/, '')}/set-password?token=${encodeURIComponent(token)}`;
}

export type PasswordTokenInfo = {
	id: number;
	userId: number;
	email: string;
	purpose: PasswordTokenPurpose;
	expiresAt: number;
};

/** Looks a link up without consuming it (so mail scanners that GET it are harmless). */
export function peekPasswordToken(token: string): PasswordTokenInfo | null {
	if (!token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
	const row = db
		.prepare(
			`SELECT t.id, t.user_id, t.purpose, t.expires_at, u.email
			 FROM password_tokens t JOIN users u ON u.id = t.user_id
			 WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > unixepoch()
			   AND u.disabled_at IS NULL`
		)
		.get(hashToken(token)) as
		| { id: number; user_id: number; purpose: PasswordTokenPurpose; expires_at: number; email: string }
		| undefined;
	if (!row) return null;
	return {
		id: row.id,
		userId: row.user_id,
		email: row.email,
		purpose: row.purpose,
		expiresAt: row.expires_at
	};
}

/**
 * Atomically spends the link and sets the password. Returns the user id, or
 * null when the link was already used, expired or replaced (so two concurrent
 * submissions cannot both win). `passwordHash` is computed by the caller first
 * so a failure while hashing never burns the link.
 */
export function redeemPasswordToken(token: string, passwordHash: string): number | null {
	const info = peekPasswordToken(token);
	if (!info) return null;
	return db.transaction((): number | null => {
		const spent = db
			.prepare(
				'UPDATE password_tokens SET used_at = unixepoch() WHERE id = ? AND used_at IS NULL AND expires_at > unixepoch()'
			)
			.run(info.id);
		if (spent.changes !== 1) return null;
		db.prepare(
			`UPDATE users
			 SET password_hash = ?, must_change_password = 0, password_changed_at = unixepoch()
			 WHERE id = ?`
		).run(passwordHash, info.userId);
		// Whoever held the old password (or a stolen session) is signed out.
		db.prepare('DELETE FROM sessions WHERE user_id = ?').run(info.userId);
		return info.userId;
	})();
}
