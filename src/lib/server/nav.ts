/**
 * Where to send a person after they sign in. Only same-site paths are allowed:
 * anything that could leave the site, loop through the auth pages or hit an
 * API route is refused (open-redirect protection).
 */
const BLOCKED_PREFIXES = [
	'/login',
	'/logout',
	'/m/',
	'/api/',
	'/set-password',
	'/forgot-password',
	'/change-password'
];

export function safeNext(raw: string | null | undefined): string | null {
	if (!raw || raw.length > 500) return null;
	if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
	if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
	const path = raw.split(/[?#]/)[0];
	if (BLOCKED_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p))) return null;
	return raw;
}

/** `/login` with a way back to the page that needed the session. */
export function loginUrlWithNext(pathAndSearch: string): string {
	const next = safeNext(pathAndSearch);
	return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

/** "j***@gmail.com": enough to recognise the account without exposing it. */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf('@');
	if (at < 1) return '***';
	return `${email[0]}***${email.slice(at)}`;
}
