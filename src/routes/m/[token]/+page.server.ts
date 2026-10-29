import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSession } from '$lib/server/auth';
import { setSessionCookie } from '$lib/server/cookies';
import { classifyDevice } from '$lib/server/device';
import { db } from '$lib/server/db';
import { consumeMagicLink, peekMagicLink } from '$lib/server/magic';
import { maskEmail } from '$lib/server/nav';
import { clientIp, rateLimit } from '$lib/server/rateLimit';

const targetFor = (ticketId: number | null) => (ticketId ? `/tickets/${ticketId}` : '/tickets');

/** Signing in with the link needs a click on the page below: opening the link alone changes nothing. */
export const load: PageServerLoad = ({ params, locals, request, getClientAddress, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
	const ip = clientIp(request.headers, getClientAddress);
	// Throttle token guessing: plenty for a human, a wall for a brute-forcer.
	if (!rateLimit(`magic:${ip}`, 60, 600).ok) throw error(429, 'Too many requests');

	const link = peekMagicLink(params.token);
	if (!link) throw redirect(303, '/login?expired=1');
	const target = targetFor(link.ticket_id);

	// Spent or expired: a normal sign-in, then straight to the conversation.
	if (!link.usable) throw redirect(303, `/login?expired=1&next=${encodeURIComponent(target)}`);
	// Already signed in as the right person: just go there.
	if (locals.user?.id === link.user_id) throw redirect(303, target);

	const user = db.prepare('SELECT email FROM users WHERE id = ? AND disabled_at IS NULL').get(link.user_id) as
		| { email: string }
		| undefined;
	if (!user) throw redirect(303, `/login?expired=1&next=${encodeURIComponent(target)}`);
	return {
		recipient: maskEmail(user.email),
		signedInAs: locals.user ? maskEmail(locals.user.email) : null,
		isTicket: link.ticket_id !== null
	};
};

export const actions: Actions = {
	default: async ({ params, cookies, request, url, getClientAddress }) => {
		const ip = clientIp(request.headers, getClientAddress);
		if (!rateLimit(`magic:${ip}`, 60, 600).ok) throw error(429, 'Too many requests');

		// Read the destination first: it stays valid even if the link turns out to be spent.
		const link = peekMagicLink(params.token);
		const target = targetFor(link?.ticket_id ?? null);
		const payload = consumeMagicLink(params.token);
		if (!payload) {
			throw redirect(303, link ? `/login?expired=1&next=${encodeURIComponent(target)}` : '/login?expired=1');
		}
		const user = db.prepare('SELECT id FROM users WHERE id = ? AND disabled_at IS NULL').get(payload.user_id) as
			| { id: number }
			| undefined;
		if (!user) throw redirect(303, '/login?expired=1');

		const sid = createSession(user.id, classifyDevice(request.headers, url));
		setSessionCookie(cookies, sid);
		throw redirect(303, targetFor(payload.ticket_id));
	}
};
