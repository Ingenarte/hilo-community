import { db } from './db';
import type { SessionUser } from './auth';
import {
	TOKEN_TTL_SECONDS,
	generateToken,
	hashToken,
	isTokenUsable,
	tokenPrefix
} from './tokenCrypto';

export const MAX_ACTIVE_TOKENS = 20;
const LAST_USED_THROTTLE_SECONDS = 60;

/** What request handlers see about the token that authenticated them. */
export type ApiTokenInfo = {
	id: number;
	name: string;
	ticketId: number | null;
	canReply: boolean;
	expiresAt: number;
};

export type ApiTokenPublic = {
	id: number;
	name: string;
	prefix: string;
	ticket_id: number | null;
	can_reply: boolean;
	expires_at: number;
	created_at: number;
	last_used_at: number | null;
};

type Row = {
	id: number;
	user_id: number;
	name: string;
	token_prefix: string;
	ticket_id: number | null;
	can_reply: 0 | 1;
	expires_at: number;
	created_at: number;
	last_used_at: number | null;
	revoked_at: number | null;
};

const toPublic = (r: Row): ApiTokenPublic => ({
	id: r.id,
	name: r.name,
	prefix: r.token_prefix,
	ticket_id: r.ticket_id,
	can_reply: r.can_reply === 1,
	expires_at: r.expires_at,
	created_at: r.created_at,
	last_used_at: r.last_used_at
});

export function countActiveApiTokens(userId: number): number {
	return (
		db
			.prepare(
				'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > unixepoch()'
			)
			.get(userId) as { n: number }
	).n;
}

export function createApiToken(args: {
	userId: number;
	name: string;
	ticketId?: number | null;
	canReply: boolean;
}): { token: string; info: ApiTokenPublic } {
	// Housekeeping: forget tokens that expired more than 30 days ago.
	db.prepare('DELETE FROM api_tokens WHERE expires_at < unixepoch() - 2592000').run();

	const token = generateToken();
	const info = db
		.prepare(
			`INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, ticket_id, can_reply, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, unixepoch() + ?)`
		)
		.run(
			args.userId,
			args.name.slice(0, 80),
			hashToken(token),
			tokenPrefix(token),
			args.ticketId ?? null,
			args.canReply ? 1 : 0,
			TOKEN_TTL_SECONDS
		);
	const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(Number(info.lastInsertRowid)) as Row;
	return { token, info: toPublic(row) };
}

/** Resolves a bearer token to its user, or null when unknown, expired, revoked or the user is disabled. */
export function authenticateToken(
	token: string
): { user: SessionUser; info: ApiTokenInfo } | null {
	const row = db
		.prepare(
			`SELECT t.*, u.email, u.role, u.theme, u.accent, u.disabled_at
			 FROM api_tokens t JOIN users u ON u.id = t.user_id
			 WHERE t.token_hash = ?`
		)
		.get(hashToken(token)) as
		| (Row & {
				email: string;
				role: 'user' | 'admin';
				theme: 'dark' | 'light';
				accent: SessionUser['accent'];
				disabled_at: number | null;
		  })
		| undefined;
	if (!row || row.disabled_at) return null;
	const now = Math.floor(Date.now() / 1000);
	if (!isTokenUsable(row, now)) return null;

	if (row.last_used_at === null || now - row.last_used_at >= LAST_USED_THROTTLE_SECONDS) {
		db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
	}
	return {
		user: { id: row.user_id, email: row.email, role: row.role, theme: row.theme, accent: row.accent },
		info: {
			id: row.id,
			name: row.name,
			ticketId: row.ticket_id,
			canReply: row.can_reply === 1,
			expiresAt: row.expires_at
		}
	};
}

export function listApiTokens(userId: number): ApiTokenPublic[] {
	return (
		db
			.prepare(
				`SELECT * FROM api_tokens
				 WHERE user_id = ? AND revoked_at IS NULL AND expires_at > unixepoch()
				 ORDER BY created_at DESC`
			)
			.all(userId) as Row[]
	).map(toPublic);
}

export function revokeApiToken(userId: number, id: number): boolean {
	return (
		db
			.prepare('UPDATE api_tokens SET revoked_at = unixepoch() WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
			.run(id, userId).changes > 0
	);
}
