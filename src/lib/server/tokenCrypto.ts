import { createHash, randomBytes } from 'node:crypto';

/** Agent tokens live 96 hours, then stop working. */
export const TOKEN_TTL_SECONDS = 96 * 3600;
export const TOKEN_PREFIX = 'hilo_';

export function generateToken(): string {
	return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** Tokens are high-entropy random strings, so a plain SHA-256 is enough. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Short, non-secret handle shown in lists (e.g. "hilo_aB3dEf"). */
export function tokenPrefix(token: string): string {
	return token.slice(0, TOKEN_PREFIX.length + 6);
}

/** Extracts a Hilo token from an Authorization header, or null. */
export function parseBearer(header: string | null | undefined): string | null {
	const m = /^Bearer\s+(\S+)$/i.exec((header ?? '').trim());
	const token = m?.[1];
	return token && token.startsWith(TOKEN_PREFIX) && token.length <= 200 ? token : null;
}

export function isTokenUsable(
	row: { expires_at: number; revoked_at: number | null },
	nowSec: number
): boolean {
	return row.revoked_at === null && row.expires_at > nowSec;
}
