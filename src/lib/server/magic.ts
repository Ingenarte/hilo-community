import { randomBytes } from 'node:crypto';
import { db } from './db';
import { config } from './env';

const MAGIC_TTL_DAYS = 30;

/**
 * Create a fresh magic-link token bound to (user_id, ticket_id).
 * Clicking the link logs the user in (creates a session) and redirects to /tickets/{id}.
 */
export function createMagicLink(userId: number, ticketId: number | null = null): string {
	const token = randomBytes(28).toString('base64url');
	const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_TTL_DAYS * 24 * 3600;
	db.prepare(
		`INSERT INTO magic_links (token, user_id, ticket_id, expires_at) VALUES (?, ?, ?, ?)`
	).run(token, userId, ticketId, expiresAt);
	return token;
}

export function magicLinkUrl(token: string): string {
	return `${config.publicBaseUrl.replace(/\/$/, '')}/m/${token}`;
}

export type ConsumedMagic = {
	user_id: number;
	ticket_id: number | null;
} | null;

/**
 * Validate a magic token: must exist, not expired. Marks it as used and returns its payload.
 * Tokens are single-use to limit re-share leakage.
 */
export function consumeMagicLink(token: string): ConsumedMagic {
	const row = db
		.prepare(
			`SELECT user_id, ticket_id, expires_at, used_at FROM magic_links WHERE token = ?`
		)
		.get(token) as
		| { user_id: number; ticket_id: number | null; expires_at: number; used_at: number | null }
		| undefined;
	if (!row) return null;
	const now = Math.floor(Date.now() / 1000);
	if (row.expires_at < now) return null;
	if (row.used_at) return null;
	db.prepare('UPDATE magic_links SET used_at = unixepoch() WHERE token = ?').run(token);
	return { user_id: row.user_id, ticket_id: row.ticket_id };
}
