import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { checkLogin, createSession } from '$lib/server/auth';
import { setSessionCookie } from '$lib/server/cookies';
import { clearRateLimit, clientIp, rateLimit, rateLimitStatus } from '$lib/server/rateLimit';

/** Wrong passwords allowed per account and hour before it is locked. */
const MAX_FAILED_LOGINS_PER_HOUR = 5;
/** Successful sign-ins allowed per account and hour. */
const MAX_LOGINS_PER_HOUR = 20;
import { config } from '$lib/server/env';
import { classifyDevice } from '$lib/server/device';
import { passkeysEnabled } from '$lib/server/passkeys';
import { safeNext } from '$lib/server/nav';

export const load: PageServerLoad = ({ locals, url }) => {
	// Where the person was heading (an email link, a bookmark): back there after signing in.
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) throw redirect(302, next ?? '/tickets');
	return {
		dynamicEnabled: config.authDynamicFormat !== 'none',
		passkeysEnabled: passkeysEnabled(),
		next,
		linkExpired: url.searchParams.get('expired') === '1'
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const ip = clientIp(request.headers, getClientAddress);
		// 10 attempts / 5 minutes per IP. Low-security spec aside, this is
		// enough to stop a script kiddie hammering the door.
		const rl = rateLimit(`login:${ip}`, 10, 300);
		if (!rl.ok) {
			return fail(429, {
				email: '',
				error: `Too many attempts. Try again in ${rl.retryAfterSeconds}s.`
			});
		}

		const form = await request.formData();
		const email = String(form.get('email') || '').trim();
		const password = String(form.get('fixed') || form.get('password') || '');
		const remember = form.get('remember') != null;
		const trap = String(form.get('company') || '');
		if (trap.trim() !== '') {
			return fail(400, { email, error: 'Invalid credentials.' });
		}

		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { email, error: 'Please enter a valid email address.' });
		}

		// Per-account throttles, independent of the per-IP limiter above so one
		// account's lockout cannot be worked around from another IP:
		//  - only WRONG credentials count towards the lockout: 5 per hour, and
		//    while locked even the right password is refused;
		//  - successful sign-ins have their own, much higher cap: 20 per hour.
		const account = email.toLowerCase();
		const failKey = `login-fail:user:${account}`;
		const locked = rateLimitStatus(failKey, MAX_FAILED_LOGINS_PER_HOUR, 3600);
		if (locked.blocked) {
			return fail(429, {
				email,
				error: `Too many attempts for this account. Try again in ${Math.ceil(
					locked.retryAfterSeconds / 60
				)} min.`
			});
		}

		// Dynamic code is only required when AUTH_DYNAMIC_FORMAT != 'none';
		// the form hides the field in that case so it arrives empty here.
		const dynamic = String(form.get('dynamic') || '');
		const user = await checkLogin(email, password, dynamic);
		if (!user) {
			rateLimit(failKey, MAX_FAILED_LOGINS_PER_HOUR, 3600);
			return fail(400, { email, error: 'Invalid credentials.' });
		}

		const okRl = rateLimit(`login-ok:user:${account}`, MAX_LOGINS_PER_HOUR, 3600);
		if (!okRl.ok) {
			return fail(429, {
				email,
				error: `Too many sign-ins for this account. Try again in ${Math.ceil(
					okRl.retryAfterSeconds / 60
				)} min.`
			});
		}
		// A correct sign-in clears the wrong-password count.
		clearRateLimit(failKey);

		// Capture device fingerprint at session creation so /admin/users can
		// report mobile vs desktop usage. The `?source=pwa` hint comes from
		// the manifest's start_url when the installed PWA initiated the
		// navigation that eventually hit /login.
		const deviceInfo = classifyDevice(request.headers, url);
		const sid = createSession(user.id, deviceInfo);
		setSessionCookie(cookies, sid, { remember });

		throw redirect(303, safeNext(url.searchParams.get('next')) ?? '/tickets');
	}
};
