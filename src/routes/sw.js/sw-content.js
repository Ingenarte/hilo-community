// @ts-nocheck — this file runs inside a ServiceWorkerGlobalScope, not in
// the regular app DOM context, so svelte-check's WindowOrWorkerGlobalScope
// types don't know about `clients`, `caches`, `skipWaiting`, etc. The
// file is imported with `?raw` from +server.ts purely as a text blob and
// shipped to the browser unmodified — TypeScript would never compile it
// either way.

// Hilo · service worker · v2
// Goals:
//   1. Keep Web Push working (push + notificationclick).
//   2. Make the app installable on Chrome with a minimal app-shell cache.
//   3. Stay online-first: tickets, messages and attachments NEVER cache —
//      the cache is only for the static shell (icons, manifest, fallback
//      HTML for the install screen).
//
// This file is served by src/routes/sw.js/+server.ts with
//   Cache-Control: no-store, must-revalidate
// so every deploy reaches the browser without CDN-cache stickiness.

const VERSION = 'hilo-v2';
const SHELL_CACHE = `${VERSION}-shell`;

// Files we want cached for the install prompt heuristic + a graceful
// "you're offline" experience when the user opens the PWA without
// connectivity. Keep this list minimal — Hilo is online-only.
const SHELL_ASSETS = [
	'/favicon.svg',
	'/favicon-32.png',
	'/logo-192.png',
	'/logo-512.png',
	'/manifest.webmanifest'
];

// ─── Install: pre-cache the shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() =>
			self.skipWaiting()
		)
	);
});

// ─── Activate: claim clients + clean old caches ────────────────────────────
self.addEventListener('activate', (event) => {
	event.waitUntil(
		Promise.all([
			caches.keys().then((names) =>
				Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)))
			),
			self.clients.claim()
		])
	);
});

// ─── Fetch: cache-first for shell assets, network-only for everything else ─
self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return; // never cache POST/PATCH/DELETE
	const url = new URL(req.url);

	// Same-origin only. Bypass the entire SW for cross-origin requests.
	if (url.origin !== self.location.origin) return;

	// Hilo runtime endpoints — DB-driven data, must never be cached.
	if (
		url.pathname.startsWith('/api/') ||
		url.pathname.startsWith('/_app/immutable/') === false &&
			(url.pathname.startsWith('/tickets') ||
				url.pathname.startsWith('/admin') ||
				url.pathname.startsWith('/preferences') ||
				url.pathname.startsWith('/login') ||
				url.pathname.startsWith('/m/'))
	) {
		return; // let the network handle it
	}

	// Shell assets: try cache first, fall through to network on miss.
	event.respondWith(
		caches.match(req).then((cached) => {
			if (cached) return cached;
			return fetch(req).then((res) => {
				// Opportunistically cache hashed Vite assets so subsequent
				// loads are instant even if SSE/HTML is slow.
				if (res.ok && url.pathname.startsWith('/_app/immutable/')) {
					const clone = res.clone();
					caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
				}
				return res;
			});
		})
	);
});

// ─── Push: OS-level notification ───────────────────────────────────────────
self.addEventListener('push', (event) => {
	let data = { title: 'Hilo', body: 'New activity' };
	try {
		if (event.data) data = event.data.json();
	} catch {
		// noop
	}
	event.waitUntil(
		self.registration.showNotification(data.title, {
			body: data.body,
			icon: data.icon || '/logo-192.png',
			badge: data.badge || '/favicon-32.png',
			tag: data.tag,
			renotify: !!data.tag,
			data: { url: data.url || '/' }
		})
	);
});

// ─── Notification click: focus an existing tab or open a new one ───────────
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data?.url || '/';
	event.waitUntil(
		clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
			for (const w of wins) {
				if (w.url.includes(url) && 'focus' in w) return w.focus();
			}
			return clients.openWindow(url);
		})
	);
});

// ─── Message bridge: let pages ask the SW to skip waiting on update ───────
self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
