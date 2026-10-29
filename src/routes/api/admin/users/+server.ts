import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { audit } from '$lib/server/audit';
import { createUserWithPassword, invalidatePassword } from '$lib/server/auth';
import { deleteAllPasskeys } from '$lib/server/passkeys';
import { generateRandomPassword } from '$lib/server/password';
import { enqueueWelcomeEmail, enqueueResetPasswordEmail } from '$lib/server/welcome';
import {
	ADMIN_RESET_TTL_SECONDS,
	WELCOME_TTL_SECONDS,
	createPasswordToken,
	passwordLinkUrl
} from '$lib/server/passwordTokens';
import { rateLimit } from '$lib/server/rateLimit';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

/**
 * GET ?q=...  → list users (newest first). Search matches email substring.
 * PATCH { id, op: 'disable' | 'enable' }
 *   - disable: sets `users.disabled_at`, drops every active session.
 *   - enable: clears `disabled_at`.
 */
export const GET: RequestHandler = ({ locals, url }) => {
	requireAdmin(locals);
	const q = (url.searchParams.get('q') ?? '').trim();
	const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 500);
	const params: Record<string, unknown> = { limit };
	let where = '';
	if (q) {
		where = 'WHERE email LIKE $like COLLATE NOCASE';
		params.like = `%${q}%`;
	}
	const rows = db
		.prepare(
			`SELECT id, email, role, theme, accent, email_schedule, disabled_at,
			        created_at, last_seen,
			        (SELECT COUNT(*) FROM tickets WHERE user_id = users.id) AS ticket_count
			 FROM users ${where}
			 ORDER BY created_at DESC LIMIT $limit`
		)
		.all(params);
	return json({ users: rows });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const body = (await request.json().catch(() => ({}))) as {
		email?: string;
		role?: 'user' | 'admin';
		projectIds?: number[];
	};

	const email = String(body.email || '').trim().toLowerCase();
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw error(400, 'Invalid email');
	}
	const role = body.role === 'admin' ? 'admin' : 'user';

	// Reject duplicates
	const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
		| { id: number }
		| undefined;
	if (exists) throw error(409, 'User already exists');

	// The account starts with a password nobody knows; the person chooses theirs
	// through the emailed one-time link.
	const created = await createUserWithPassword(email, role, generateRandomPassword());

	// Assign to projects (only valid, non-archived ones)
	const projectIds = Array.isArray(body.projectIds)
		? body.projectIds.filter((n): n is number => Number.isFinite(n) && n > 0)
		: [];
	if (projectIds.length > 0) {
		const insert = db.prepare(
			'INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)'
		);
		const validIds = db
			.prepare(
				`SELECT id FROM projects WHERE id IN (${projectIds.map(() => '?').join(',')}) AND status != 'archived'`
			)
			.all(...projectIds) as Array<{ id: number }>;
		for (const p of validIds) insert.run(created.id, p.id);
	}

	const welcomeToken = createPasswordToken(created.id, 'welcome', WELCOME_TTL_SECONDS);
	await enqueueWelcomeEmail({
		toEmail: email,
		userId: created.id,
		role,
		setPasswordUrl: passwordLinkUrl(welcomeToken),
		ttlSeconds: WELCOME_TTL_SECONDS
	});

	audit('user.created', {
		actor: locals.user,
		target: `user:${created.id}`,
		detail: { email, role, projectIds }
	});

	return json({ ok: true, userId: created.id, email });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { id?: number; op?: string };
	const id = Number(data.id);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'id required');
	if (id === locals.user!.id) throw error(400, 'Cannot disable yourself');

	if (data.op === 'disable') {
		db.prepare('UPDATE users SET disabled_at = unixepoch() WHERE id = ?').run(id);
		db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
		audit('user.disabled', { actor: locals.user, target: `user:${id}` });
		return json({ ok: true });
	}
	if (data.op === 'enable') {
		db.prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(id);
		audit('user.enabled', { actor: locals.user, target: `user:${id}` });
		return json({ ok: true });
	}
	if (data.op === 'reset_password') {
		// 10 resets per minute per admin — same ceiling as admin-delete-user.
		const rl = rateLimit(`admin-reset-password:user:${locals.user!.id}`, 10, 60);
		if (!rl.ok) {
			return json({ error: 'Too many requests — try again shortly' }, { status: 429 });
		}
		const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(id) as
			| { id: number; email: string }
			| undefined;
		if (!target) throw error(404, 'User not found');

		// The old password stops working and every session is closed; the person
		// chooses a new password through a one-time link sent by email.
		await invalidatePassword(id);
		db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
		// A reset also revokes passkeys: if the account was compromised, a passkey
		// the intruder registered must not survive. The person registers a new one.
		const passkeysRemoved = deleteAllPasskeys(id);
		const resetToken = createPasswordToken(id, 'reset', ADMIN_RESET_TTL_SECONDS);
		await enqueueResetPasswordEmail({
			toEmail: target.email,
			userId: id,
			initiatedBy: 'admin',
			setPasswordUrl: passwordLinkUrl(resetToken),
			ttlSeconds: ADMIN_RESET_TTL_SECONDS
		});
		audit('user.password_reset', {
			actor: locals.user,
			target: `user:${id}`,
			detail: { passkeys_removed: passkeysRemoved }
		});
		return json({ ok: true });
	}
	return json({ error: 'op must be enable, disable, or reset_password' }, { status: 400 });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);

	// Rate-limit: 10 deletes per minute per admin.
	const rl = rateLimit(`admin-delete-user:user:${locals.user!.id}`, 10, 60);
	if (!rl.ok) {
		return json({ error: 'Too many requests — try again shortly' }, { status: 429 });
	}

	const data = (await request.json().catch(() => ({}))) as {
		id?: number;
		confirm_email?: string;
	};
	const id = Number(data.id);
	if (!Number.isFinite(id) || id <= 0) {
		return json({ error: 'id is required' }, { status: 400 });
	}
	if (id === locals.user!.id) {
		return json({ error: 'You cannot delete yourself' }, { status: 400 });
	}

	const target = db
		.prepare('SELECT id, email, role, disabled_at FROM users WHERE id = ?')
		.get(id) as { id: number; email: string; role: string; disabled_at: number | null } | undefined;
	if (!target) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	// Case-insensitive email confirmation.
	const confirmEmail = String(data.confirm_email ?? '').trim();
	if (confirmEmail.toLowerCase() !== target.email.toLowerCase()) {
		return json({ error: 'confirm_email does not match' }, { status: 400 });
	}

	// Last-admin guard: refuse to delete the last active admin.
	if (target.role === 'admin') {
		const { n } = db
			.prepare(
				"SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL"
			)
			.get() as { n: number };
		if (n <= 1) {
			return json(
				{ error: 'Refused: would leave the instance without admins' },
				{ status: 400 }
			);
		}
	}

	// FK cascade handles tickets, messages, reactions, sessions, magic_links,
	// user_projects, group_users, ticket_reads, ticket_tasks, push_subscriptions,
	// upload_sessions.
	db.prepare('DELETE FROM users WHERE id = ?').run(id);

	audit('user.deleted', {
		actor: locals.user,
		target: `user:${id}`,
		detail: { email: target.email, role: target.role }
	});

	return json({ ok: true });
};
