import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { subscribePush, unsubscribePush, vapidConfigured } from '$lib/server/webpush';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!vapidConfigured())
		return json({ error: 'Web Push is not configured on this instance.' }, { status: 503 });
	const data = (await request.json().catch(() => null)) as {
		endpoint?: string;
		keys?: { p256dh?: string; auth?: string };
	} | null;
	if (!data || !data.endpoint || !data.keys?.p256dh || !data.keys?.auth)
		return json({ error: 'Invalid subscription payload.' }, { status: 400 });

	subscribePush(locals.user.id, {
		endpoint: data.endpoint,
		keys: { p256dh: data.keys.p256dh, auth: data.keys.auth }
	});
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const data = (await request.json().catch(() => ({}))) as { endpoint?: string };
	if (!data.endpoint) return json({ error: 'endpoint required' }, { status: 400 });
	unsubscribePush(locals.user.id, data.endpoint);
	return json({ ok: true });
};
