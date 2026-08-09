/**
 * Browser-side push notifications. Uses the standard Notification API — no
 * service worker, no VAPID, no external push service. The hook only fires
 * when the page is not focused, so the user doesn't get duplicate signals.
 */

const STORAGE_KEY = 'hilo.notify.enabled';

export type NotifyState = 'unsupported' | 'denied' | 'default' | 'granted-off' | 'granted-on';

export function notifyState(): NotifyState {
	if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
	const perm = Notification.permission;
	if (perm === 'denied') return 'denied';
	if (perm === 'default') return 'default';
	const on = localStorage.getItem(STORAGE_KEY) === '1';
	return on ? 'granted-on' : 'granted-off';
}

export async function enableNotifications(): Promise<NotifyState> {
	if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
	if (Notification.permission === 'default') {
		const result = await Notification.requestPermission();
		if (result !== 'granted') {
			return result === 'denied' ? 'denied' : 'default';
		}
	}
	if (Notification.permission !== 'granted') return notifyState();
	localStorage.setItem(STORAGE_KEY, '1');
	return 'granted-on';
}

export function disableNotifications(): void {
	if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, '0');
}

/**
 * Shows a notification only if (a) the user opted-in, (b) the tab is not in
 * focus. Returns true if shown.
 */
/**
 * Register the service worker and subscribe to Web Push. Idempotent.
 * Returns true if a server-side subscription is now active.
 */
export async function ensurePushSubscription(): Promise<boolean> {
	if (typeof window === 'undefined') return false;
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
	if (Notification.permission !== 'granted') return false;

	const meta = await fetch('/api/push/public-key').then((r) => r.json()).catch(() => null);
	if (!meta || !meta.enabled || !meta.key) return false;

	const reg = await navigator.serviceWorker.register('/sw.js');
	const existing = await reg.pushManager.getSubscription();
	const sub =
		existing ??
		(await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(meta.key)
		}));

	const subJson = sub.toJSON();
	const res = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(subJson)
	});
	return res.ok;
}

function urlBase64ToUint8Array(base64: string): BufferSource {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(b64);
	// Backed by a real ArrayBuffer (not SharedArrayBuffer) so the DOM
	// PushManager type-checks accept it without a cast.
	const buf = new ArrayBuffer(raw.length);
	const view = new Uint8Array(buf);
	for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
	return view;
}

export function maybeNotify(args: {
	title: string;
	body?: string;
	icon?: string;
	tag?: string;
	onClickUrl?: string;
}): boolean {
	if (typeof window === 'undefined' || !('Notification' in window)) return false;
	if (Notification.permission !== 'granted') return false;
	if (localStorage.getItem(STORAGE_KEY) !== '1') return false;
	if (document.visibilityState === 'visible' && document.hasFocus()) return false;

	try {
		const n = new Notification(args.title, {
			body: args.body,
			// Larger logo file so the OS doesn't fall back to a generic
			// globe icon when it can't decide what to render at tile size.
			icon: args.icon ?? '/logo-192.png',
			// Mono badge for Linux notification daemons + Android.
			badge: '/favicon-32.png',
			tag: args.tag
		});
		if (args.onClickUrl) {
			n.onclick = () => {
				window.focus();
				// Avoid kicking off a full page reload when we're already at
				// the target route — some Linux notification daemons fire
				// onclick implicitly when the popup closes, which would
				// otherwise reload the open ticket every few seconds.
				const target = args.onClickUrl;
				if (target && location.pathname !== target) {
					window.location.href = target;
				}
				n.close();
			};
		}
		return true;
	} catch {
		return false;
	}
}
