import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
	password: string | Buffer,
	salt: Buffer,
	keylen: number
) => Promise<Buffer>;

// Format: scrypt$N=16384,r=8,p=1$<salt-base64>$<hash-base64>
// N/r/p are inlined so future default changes allow transparent rehash.
const N = 16384;
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
	if (!plain || plain.length < 8) throw new Error('Password too short');
	const salt = randomBytes(SALT_BYTES);
	const hash = await scrypt(plain, salt, KEYLEN);
	return `scrypt$N=${N},r=8,p=1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
	if (!stored) return false;
	const parts = stored.split('$');
	if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
	const salt = Buffer.from(parts[2], 'base64');
	const expected = Buffer.from(parts[3], 'base64');
	const actual = await scrypt(plain, salt, expected.length);
	if (actual.length !== expected.length) return false;
	return timingSafeEqual(actual, expected);
}

// 8-char password from an alphabet without visually ambiguous chars
// (no I/O/l/0/1). ~47 bits of entropy. Combined with Hilo's existing
// rate limit (10 login attempts / 5 min per IP) and the daily dynamic
// code, brute-forcing online is impractical. Short by spec for UX.
export function generateRandomPassword(): string {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
	const bytes = randomBytes(8);
	let out = '';
	for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
	return out;
}
