/**
 * Centralised cookie policy. Importing this from one place avoids drift between
 * the login and magic-link sign-in flows.
 *
 * In production (NODE_ENV=production) we enable Secure; we expect Hilo to live
 * behind a TLS-terminating reverse proxy (Caddy / nginx / Cloudflare).
 */
import type { Cookies } from '@sveltejs/kit';
import { SESSION_COOKIE, SESSION_MAX_AGE } from './auth';
import { PROD } from './utils';

export function setSessionCookie(
	cookies: Cookies,
	sid: string,
	opts: { remember?: boolean } = {}
): void {
	const remember = opts.remember ?? true;
	cookies.set(SESSION_COOKIE, sid, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: PROD,
		// remember=true → 10-year cookie (the historical default).
		// remember=false → omit maxAge so the browser treats it as a
		// session cookie that dies when the window/profile closes.
		...(remember ? { maxAge: SESSION_MAX_AGE } : {})
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
