import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SESSION_COOKIE, changeUserPassword } from '$lib/server/auth';
import { isPwnedPassword } from '$lib/server/pwned';
import { rateLimit } from '$lib/server/rateLimit';
import { audit } from '$lib/server/audit';
import { PASSWORD_PROBLEM_MESSAGE, validateNewPassword } from '$lib/passwordPolicy';

// Forced screen: shown while the account still has a temporary password.
export const load: PageServerLoad = ({ locals, setHeaders }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (!locals.user.mustChangePassword) throw redirect(302, '/preferences');
	setHeaders({ 'Cache-Control': 'no-store' });
	return { email: locals.user.email };
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		if (!locals.user) throw redirect(302, '/login');
		if (!locals.user.mustChangePassword) throw redirect(303, '/preferences');

		const rl = rateLimit(`password-change:user:${locals.user.id}`, 5, 60);
		if (!rl.ok) {
			return fail(429, { error: `Too many attempts. Try again in ${rl.retryAfterSeconds}s.` });
		}

		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		if (password !== confirm) return fail(400, { error: PASSWORD_PROBLEM_MESSAGE.mismatch });
		const problem = validateNewPassword(password, locals.user.email);
		if (problem) return fail(400, { error: PASSWORD_PROBLEM_MESSAGE[problem] });
		if (await isPwnedPassword(password)) {
			return fail(400, { error: PASSWORD_PROBLEM_MESSAGE.pwned });
		}

		await changeUserPassword(locals.user.id, password, cookies.get(SESSION_COOKIE) ?? '');
		audit('user.password_changed_first_login', { actor: locals.user, target: `user:${locals.user.id}` });
		throw redirect(303, '/tickets');
	}
};
