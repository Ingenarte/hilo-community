/**
 * Which channel tells a person about ticket activity: email, web push, or both.
 *
 * Default ("auto"): someone with an active push subscription gets push only,
 * everyone else gets email. Admins change the instance default and can
 * override it per user from /admin/notifications.
 */

import { db } from './db';
import { vapidConfigured } from './webpush';

export type DeliveryMode = 'auto' | 'email' | 'push';
export const DELIVERY_MODES: readonly DeliveryMode[] = ['auto', 'email', 'push'];

export type Channels = { email: boolean; push: boolean };

const MODE_KEY = 'notify_mode';
const CAP_KEY = 'notify_email_daily_cap';

function getMeta(key: string): string | null {
	const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

function setMeta(key: string, value: string): void {
	db.prepare(
		`INSERT INTO app_meta (key, value, set_at) VALUES (?, ?, unixepoch())
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, set_at = unixepoch()`
	).run(key, value);
}

export function isDeliveryMode(v: unknown): v is DeliveryMode {
	return typeof v === 'string' && (DELIVERY_MODES as readonly string[]).includes(v);
}

export function getDefaultMode(): DeliveryMode {
	const v = getMeta(MODE_KEY);
	return isDeliveryMode(v) ? v : 'auto';
}

export function setDefaultMode(mode: DeliveryMode): void {
	setMeta(MODE_KEY, mode);
}

/** When on, a person gets at most one unread-message email per day. Off by default. */
export function getEmailDailyCap(): boolean {
	return getMeta(CAP_KEY) === '1';
}

export function setEmailDailyCap(on: boolean): void {
	setMeta(CAP_KEY, on ? '1' : '0');
}

export function hasPushSubscription(userId: number): boolean {
	if (!vapidConfigured()) return false;
	return !!db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1').get(userId);
}

/** Pure decision, exposed for tests. */
export function decideChannels(mode: DeliveryMode, hasPush: boolean): Channels {
	if (mode === 'email') return { email: true, push: false };
	// 'auto' and 'push': push when the person can receive it, email otherwise.
	return hasPush ? { email: false, push: true } : { email: true, push: false };
}

export function channelsForUser(userId: number): Channels {
	const row = db.prepare('SELECT notify_mode FROM users WHERE id = ?').get(userId) as
		| { notify_mode: string | null }
		| undefined;
	const mode = isDeliveryMode(row?.notify_mode) ? row!.notify_mode : getDefaultMode();
	return decideChannels(mode as DeliveryMode, hasPushSubscription(userId));
}
