import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSession } from '$lib/server/auth';
import { setSessionCookie } from '$lib/server/cookies';
import { consumeMagicLink } from '$lib/server/magic';
import { db } from '$lib/server/db';
import { clientIp, rateLimit } from '$lib/server/rateLimit';

export const GET: RequestHandler = ({ params, cookies, request, getClientAddress }) => {
	const token = params.token;
	if (!token) throw error(404, 'Not found');

	// Throttle token guessing — 60 hits per IP per 10 minutes is plenty for
	// a human clicking links from email, but a hard wall for a brute-forcer.
	const ip = clientIp(request.headers, getClientAddress);
	const rl = rateLimit(`magic:${ip}`, 60, 600);
	if (!rl.ok) {
		return new Response('Too many requests', {
			status: 429,
			headers: { 'Retry-After': String(rl.retryAfterSeconds) }
		});
	}

	const payload = consumeMagicLink(token);
	if (!payload) {
		throw redirect(303, '/login?expired=1');
	}

	const user = db
		.prepare('SELECT id, email, role FROM users WHERE id = ?')
		.get(payload.user_id) as { id: number; email: string; role: 'user' | 'admin' } | undefined;
	if (!user) throw error(404, 'User not found');

	const sid = createSession(user.id);
	setSessionCookie(cookies, sid);

	const target = payload.ticket_id ? `/tickets/${payload.ticket_id}` : '/tickets';
	throw redirect(303, target);
};
