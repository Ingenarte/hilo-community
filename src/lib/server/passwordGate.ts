/**
 * While a user still holds a temporary password (`must_change_password`), the
 * only things reachable are the "choose your password" screen, sign out and
 * static assets. Pure so it can be unit tested.
 */
const ALLOWED_PREFIXES = [
	'/change-password',
	'/set-password',
	'/api/me/password',
	'/logout',
	'/api/health',
	'/_app/',
	'/sw.js'
];
const STATIC_FILE = /\.(?:png|jpe?g|svg|ico|webmanifest|css|js|woff2?|txt)$/i;

export type GateDecision = 'allow' | 'redirect' | 'block';

export function passwordGate(pathname: string, method: string): GateDecision {
	if (ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`))) {
		return 'allow';
	}
	if (method === 'GET' && STATIC_FILE.test(pathname)) return 'allow';
	if (method === 'GET' && !pathname.startsWith('/api/')) return 'redirect';
	return 'block';
}
