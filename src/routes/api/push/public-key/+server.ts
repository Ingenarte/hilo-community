import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { vapidConfigured, vapidPublicKey } from '$lib/server/webpush';

/**
 * GET /api/push/public-key
 * Returns `{ key: <base64url>, enabled: boolean }`. Clients use this to
 * subscribe via the PushManager. When VAPID isn't configured we return
 * `enabled: false` so the UI can hide the opt-in.
 */
export const GET: RequestHandler = () => {
	if (!vapidConfigured()) return json({ enabled: false, key: null });
	return json({ enabled: true, key: vapidPublicKey() });
};
