import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { audit } from '$lib/server/audit';
import {
	getDefaultMode,
	getEmailDailyCap,
	hasPushSubscription,
	isDeliveryMode,
	setDefaultMode,
	setEmailDailyCap
} from '$lib/server/deliveryPolicy';
import { vapidConfigured } from '$lib/server/webpush';

function requireAdmin(locals: App.Locals) {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'admin') throw error(403, 'Forbidden');
	return locals.user;
}

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const users = (
		db
			.prepare(`SELECT id, email, role, notify_mode FROM users WHERE disabled_at IS NULL ORDER BY email`)
			.all() as Array<{ id: number; email: string; role: string; notify_mode: string | null }>
	).map((u) => ({ ...u, hasPush: hasPushSubscription(u.id) }));
	return {
		defaultMode: getDefaultMode(),
		dailyCap: getEmailDailyCap(),
		pushAvailable: vapidConfigured(),
		users
	};
};

export const actions: Actions = {
	settings: async ({ locals, request }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		const mode = String(form.get('mode') ?? '');
		if (!isDeliveryMode(mode)) return fail(400, { error: 'Unknown delivery mode.' });
		const cap = form.get('dailyCap') === 'on';
		setDefaultMode(mode);
		setEmailDailyCap(cap);
		audit('notifications.settings_changed', { actor: admin, target: null, detail: { mode, dailyCap: cap } });
		return { ok: true };
	},
	user: async ({ locals, request }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		const id = Number(form.get('userId'));
		const raw = String(form.get('mode') ?? '');
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Invalid user.' });
		if (raw !== 'inherit' && !isDeliveryMode(raw)) return fail(400, { error: 'Unknown delivery mode.' });
		const value = raw === 'inherit' ? null : raw;
		const r = db.prepare('UPDATE users SET notify_mode = ? WHERE id = ?').run(value, id);
		if (r.changes === 0) return fail(404, { error: 'User not found.' });
		audit('notifications.user_mode_changed', { actor: admin, target: `user:${id}`, detail: { mode: value } });
		return { ok: true };
	}
};
