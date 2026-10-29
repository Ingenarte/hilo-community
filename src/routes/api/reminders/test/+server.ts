import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/audit';
import { assertSameOriginJson } from '$lib/server/csrf';
import { rateLimit } from '$lib/server/rateLimit';
import { sendTestReminder } from '$lib/server/reminders';

/** POST /api/reminders/test -> queues a test reminder email to me, right now. */
export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	assertSameOriginJson(request, url);
	const rl = rateLimit(`reminder-test:user:${locals.user.id}`, 5, 3600);
	if (!rl.ok) {
		return json({ error: 'Too many test emails, try again later.' }, { status: 429 });
	}
	const { sent } = sendTestReminder(locals.user.id);
	audit('reminders.test_sent', { actor: locals.user, target: `user:${locals.user.id}` });
	return json({ ok: sent, email: locals.user.email });
};
