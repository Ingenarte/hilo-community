import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { findActiveUserByEmail } from '$lib/server/auth';
import {
	SELF_RESET_TTL_SECONDS,
	createPasswordToken,
	passwordLinkUrl
} from '$lib/server/passwordTokens';
import { enqueueResetPasswordEmail } from '$lib/server/welcome';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { audit } from '$lib/server/audit';

export const load: PageServerLoad = ({ locals }) => {
	return { loggedIn: !!locals.user };
};

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		const ip = clientIp(request.headers, getClientAddress);
		// 5 requests / 5 minutes per IP — mirrors the login form's per-IP ceiling.
		const ipRl = rateLimit(`forgot-password:${ip}`, 5, 300);
		if (!ipRl.ok) {
			return fail(429, { error: `Too many attempts. Try again in ${ipRl.retryAfterSeconds}s.` });
		}

		const form = await request.formData();
		const email = String(form.get('email') || '').trim();
		const trap = String(form.get('company') || '');
		if (trap.trim() !== '') {
			return { ok: true };
		}

		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { email, error: 'Please enter a valid email address.' });
		}

		// 5 requests per hour per address, so this cannot be used to flood
		// someone's inbox. Separate from the login throttle on purpose.
		const userRl = rateLimit(`forgot-password:user:${email.toLowerCase()}`, 5, 3600);
		if (!userRl.ok) {
			return fail(429, {
				email,
				error: `Too many attempts for this account. Try again in ${Math.ceil(
					userRl.retryAfterSeconds / 60
				)} min.`
			});
		}

		// Always respond the same way whether or not the account exists, so
		// this endpoint can't be used to enumerate registered emails.
		const user = findActiveUserByEmail(email);
		if (user) {
			// Nothing changes until the link is used: the current password keeps
			// working and sessions stay open, so a stranger who types someone's
			// email cannot lock them out.
			const token = createPasswordToken(user.id, 'reset', SELF_RESET_TTL_SECONDS);
			await enqueueResetPasswordEmail({
				toEmail: user.email,
				userId: user.id,
				initiatedBy: 'self',
				setPasswordUrl: passwordLinkUrl(token),
				ttlSeconds: SELF_RESET_TTL_SECONDS
			});
			audit('user.password_reset_requested', { target: `user:${user.id}` });
		}

		return { ok: true, email };
	}
};
