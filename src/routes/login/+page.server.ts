import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { checkLogin, createSession } from '$lib/server/auth';
import { setSessionCookie } from '$lib/server/cookies';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { config } from '$lib/server/env';
import { classifyDevice } from '$lib/server/device';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) throw redirect(302, '/tickets');
	return {
		dynamicEnabled: config.authDynamicFormat !== 'none'
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

		// Dynamic code is only required when AUTH_DYNAMIC_FORMAT != 'none';
		// the form hides the field in that case so it arrives empty here.
		const dynamic = String(form.get('dynamic') || '');
		const user = await checkLogin(email, password, dynamic);
		if (!user) return fail(400, { email, error: 'Invalid credentials.' });

		// Capture device fingerprint at session creation so /admin/users can
		// report mobile vs desktop usage. The `?source=pwa` hint comes from
		// the manifest's start_url when the installed PWA initiated the
		// navigation that eventually hit /login.
		const deviceInfo = classifyDevice(request.headers, url);
		const sid = createSession(user.id, deviceInfo);
		setSessionCookie(cookies, sid, { remember });

		throw redirect(303, '/tickets');
	}
};
