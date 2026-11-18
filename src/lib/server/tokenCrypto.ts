import { createHash, randomBytes } from 'node:crypto';

/** Agent tokens live 96 hours by default, then stop working. */
export const TOKEN_TTL_SECONDS = 96 * 3600;
export const DEFAULT_TOKEN_TTL_DAYS = 4;
/** Lifetimes an admin can pick for a token (days), before the instance cap. */
export const TOKEN_TTL_DAY_CHOICES = [4, 30, 90, 365] as const;
export const DEFAULT_MAX_TOKEN_TTL_DAYS = 365;

/** Parses API_TOKEN_MAX_TTL_DAYS; invalid or empty values fall back to 365, never below 4. */
export function parseMaxTtlDays(raw: string | undefined): number {
	const n = Number(raw);
	if (!raw || !Number.isInteger(n) || n <= 0) return DEFAULT_MAX_TOKEN_TTL_DAYS;
	return Math.max(DEFAULT_TOKEN_TTL_DAYS, n);
}

/** The lifetimes (days) a user may choose: admins get the choices up to the cap, others only the default. */
export function allowedTtlDays(isAdmin: boolean, maxDays: number): number[] {
	if (!isAdmin) return [DEFAULT_TOKEN_TTL_DAYS];
	return TOKEN_TTL_DAY_CHOICES.filter((d) => d <= maxDays);
}

/**
 * Validates a requested lifetime. Returns the lifetime in seconds, or an error
 * message. An absent value means the 96 hour default.
 */
export function resolveTokenTtl(
	requested: unknown,
	isAdmin: boolean,
	maxDays: number
): { seconds: number } | { error: string } {
	if (requested === undefined || requested === null) return { seconds: TOKEN_TTL_SECONDS };
	const days = Number(requested);
	const allowed = allowedTtlDays(isAdmin, maxDays);
	if (!Number.isInteger(days) || !allowed.includes(days)) {
		return {
			error: isAdmin
				? `ttlDays must be one of ${allowed.join(', ')}`
				: 'Only admins can choose a token lifetime'
		};
	}
	return { seconds: days === DEFAULT_TOKEN_TTL_DAYS ? TOKEN_TTL_SECONDS : days * 86400 };
}
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
