// Password rules shared by the server and the forms (client-safe: no imports).
// Follows NIST SP 800-63B: a sensible minimum length, a generous maximum, no
// composition rules, and a block on trivially guessable choices. Breached-
// password screening lives server-side in `server/pwned.ts`.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON = new Set([
	'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
	'12345678', '123456789', '1234567890', '123123123', '11111111', '00000000', '87654321',
	'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', '1q2w3e4r',
	'1qaz2wsx', 'iloveyou', 'letmein1', 'welcome1', 'welcome123', 'admin123', 'administrator',
	'changeme', 'changeme1', 'abc12345', 'abcd1234', 'monkey123', 'dragon123', 'football1',
	'baseball1', 'superman1', 'trustno1', 'sunshine1', 'princess1', 'contrasena', 'contrasena1',
	'contraseña', 'hola1234', 'bienvenido', 'bienvenido1', 'hilo1234', 'hilohilo'
]);

export type PasswordProblem =
	| 'too_short'
	| 'too_long'
	| 'too_common'
	| 'repetitive'
	| 'contains_email';

export function validateNewPassword(password: string, email = ''): PasswordProblem | null {
	if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
	if (password.length > MAX_PASSWORD_LENGTH) return 'too_long';
	const lower = password.toLowerCase();
	if (COMMON.has(lower)) return 'too_common';
	if (/^(.)\1+$/.test(password)) return 'repetitive';
	const local = email.split('@')[0]?.toLowerCase() ?? '';
	if (email && (lower === email.toLowerCase() || (local.length >= 4 && lower.includes(local)))) {
		return 'contains_email';
	}
	return null;
}

export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem | 'pwned' | 'mismatch', string> = {
	too_short: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
	too_long: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
	too_common: 'That password is too common. Pick something harder to guess.',
	repetitive: 'That password is too repetitive. Pick something harder to guess.',
	contains_email: 'The password must not contain your email address.',
	pwned: 'That password appears in known data breaches. Please choose a different one.',
	mismatch: 'The two passwords do not match.'
};
