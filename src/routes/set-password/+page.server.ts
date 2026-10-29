import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSession } from '$lib/server/auth';
import { setSessionCookie } from '$lib/server/cookies';
import { classifyDevice } from '$lib/server/device';
import { hashPassword } from '$lib/server/password';
import { peekPasswordToken, redeemPasswordToken } from '$lib/server/passwordTokens';
import { isPwnedPassword } from '$lib/server/pwned';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { audit } from '$lib/server/audit';
import { PASSWORD_PROBLEM_MESSAGE, validateNewPassword } from '$lib/passwordPolicy';

// The link carries a secret: never leak it through the Referer header and
// never cache the page.
function protect(setHeaders: (h: Record<string, string>) => void) {
	setHeaders({ 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
}

export const load: PageServerLoad = ({ url, setHeaders }) => {
	protect(setHeaders);
	const token = url.searchParams.get('token') ?? '';
	// Peeking does not spend the link, so email scanners that open it are harmless.
	const info = peekPasswordToken(token);
	return {
		token,
		valid: info !== null,
		email: info?.email ?? '',
		purpose: info?.purpose ?? null
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url, setHeaders }) => {
		protect(setHeaders);
		const ip = clientIp(request.headers, getClientAddress);
		const rl = rateLimit(`set-password:${ip}`, 10, 600);
		if (!rl.ok) {
			return fail(429, { error: `Too many attempts. Try again in ${rl.retryAfterSeconds}s.` });
		}

		const form = await request.formData();
		const token = String(form.get('token') ?? '');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');

		const info = peekPasswordToken(token);
		if (!info) {
			return fail(400, { token, expired: true, error: 'This link is no longer valid.' });
		}
		if (password !== confirm) {
			return fail(400, { token, error: PASSWORD_PROBLEM_MESSAGE.mismatch });
		}
		const problem = validateNewPassword(password, info.email);
		if (problem) return fail(400, { token, error: PASSWORD_PROBLEM_MESSAGE[problem] });
		if (await isPwnedPassword(password)) {
			return fail(400, { token, error: PASSWORD_PROBLEM_MESSAGE.pwned });
		}

		// Hash first so a failure never burns the link, then spend it atomically.
		const hash = await hashPassword(password);
		const userId = redeemPasswordToken(token, hash);
		if (userId === null) {
			return fail(400, { token, expired: true, error: 'This link is no longer valid.' });
		}

		audit('user.password_set_via_link', { target: `user:${userId}`, detail: { purpose: info.purpose } });

		// Proving control of the mailbox is enough to start a session.
		const sid = createSession(userId, classifyDevice(request.headers, url));
		setSessionCookie(cookies, sid, { remember: true });
		throw redirect(303, '/tickets');
	}
};
