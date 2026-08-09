import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { SESSION_COOKIE, setUserPassword } from '$lib/server/auth';
import { verifyPassword } from '$lib/server/password';
import { rateLimit } from '$lib/server/rateLimit';

/** Minimum password length — must match hashPassword's own guard. */
const MIN_PASSWORD_LENGTH = 8;

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	// Rate limit: 5 attempts per minute per user to slow brute-force probing.
	const rl = rateLimit(`password-change:user:${locals.user.id}`, 5, 60);
	if (!rl.ok) {
		return json(
			{ error: 'rate_limited' },
			{
				status: 429,
				headers: { 'Retry-After': String(rl.retryAfterSeconds) }
			}
		);
	}

	let current: string;
	let next: string;
	try {
		const body = (await request.json()) as { current?: unknown; next?: unknown };
		if (typeof body.current !== 'string' || typeof body.next !== 'string') {
			throw new Error('bad body');
		}
		current = body.current;
		next = body.next;
	} catch {
		throw error(400, 'Request body must be JSON with {current, next} strings');
	}

	// Load the stored hash — separate query so we don't expose it via locals.
	const row = db
		.prepare('SELECT password_hash FROM users WHERE id = ?')
		.get(locals.user.id) as { password_hash: string | null } | undefined;

	if (!row?.password_hash) {
		// User account not bootstrapped with a password yet.
		throw error(409, JSON.stringify({ error: 'no_password_set' }));
	}

	// Verify current password. Use a generic error message so an attacker
	// cannot distinguish "wrong current" from other failure modes.
	const currentOk = await verifyPassword(current, row.password_hash);
	if (!currentOk) {
		return json({ error: 'invalid_current_password' }, { status: 401 });
	}

	// Validate the new password.
	if (next.length < MIN_PASSWORD_LENGTH) {
		return json({ error: 'weak_password' }, { status: 400 });
	}
	if (next === current) {
		return json({ error: 'password_unchanged' }, { status: 400 });
	}

	// Persist the new password hash.
	await setUserPassword(locals.user.id, next);

	// Revoke every other active session so devices using the old password
	// are forced to re-authenticate. Keep only the current session.
	const currentSessionId = cookies.get(SESSION_COOKIE) ?? '';
	const revoked = db
		.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
		.run(locals.user.id, currentSessionId);

	return json({ ok: true, other_sessions_revoked: revoked.changes });
};
