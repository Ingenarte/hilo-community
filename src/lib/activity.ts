/**
 * Client-side activity indicators when the tab is open.
 *
 *  - Bumps `document.title` with an unread counter `(N) Hilo`.
 *  - Repaints the favicon with a tiny red dot + number.
 *  - Calls `navigator.setAppBadge(n)` so installed PWAs (macOS Dock,
 *    Windows taskbar, Android home screen) show the count over their
 *    icon. Silently no-ops where the Badging API isn't supported.
 *  - Plays a short two-tone "ping" via Web Audio when a new message
 *    arrives. Default ON; honour `localStorage['hilo:sound']` = 'off'.
 *
 * The counter is reset whenever the tab regains focus.
 */

const ORIGINAL_TITLE = typeof document !== 'undefined' ? document.title : 'Hilo';
const FAVICON_HREF = '/favicon.svg';

let unread = 0;
let originalLink: HTMLLinkElement | null = null;
let audioCtx: AudioContext | null = null;

function getOriginalFaviconLink(): HTMLLinkElement {
	if (originalLink) return originalLink;
	const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (link) {
		originalLink = link;
		return link;
	}
	const fresh = document.createElement('link');
	fresh.rel = 'icon';
	fresh.href = FAVICON_HREF;
	document.head.appendChild(fresh);
	originalLink = fresh;
	return fresh;
}

function setFaviconBadge(count: number) {
	const link = getOriginalFaviconLink();
	if (count <= 0) {
		link.href = FAVICON_HREF;
		return;
	}
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const img = new Image();
	img.src = FAVICON_HREF;
	img.onload = () => {
		ctx.drawImage(img, 0, 0, size, size);
		const r = 22;
		const cx = size - r;
		const cy = r;
		ctx.fillStyle = '#ef4444';
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 28px -apple-system, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(count > 9 ? '9+' : String(count), cx, cy + 2);
		link.href = canvas.toDataURL('image/png');
	};
	// SVG sources may fail to draw on some browsers; in that case fall back to a
	// plain red dot without the underlying logo.
	img.onerror = () => {
		ctx.fillStyle = '#ef4444';
		ctx.beginPath();
		ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 36px -apple-system, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(count > 9 ? '9+' : String(count), size / 2, size / 2 + 2);
		link.href = canvas.toDataURL('image/png');
	};
}

function setTitleBadge(count: number) {
	if (typeof document === 'undefined') return;
	document.title = count > 0 ? `(${count > 9 ? '9+' : count}) ${ORIGINAL_TITLE}` : ORIGINAL_TITLE;
}

function setOSBadge(count: number) {
	// Badging API — supported in Chrome/Edge/Brave installed PWAs.
	type NavWithBadge = Navigator & {
		setAppBadge?: (n?: number) => Promise<void>;
		clearAppBadge?: () => Promise<void>;
	};
	const n = navigator as NavWithBadge;
	if (count > 0 && typeof n.setAppBadge === 'function') {
		n.setAppBadge(count).catch(() => undefined);
	} else if (typeof n.clearAppBadge === 'function') {
		n.clearAppBadge().catch(() => undefined);
	}
}

function isSoundEnabled(): boolean {
	try {
		return localStorage.getItem('hilo:sound') !== 'off';
	} catch {
		return true;
	}
}

export function setSoundEnabled(on: boolean): void {
	try {
		localStorage.setItem('hilo:sound', on ? 'on' : 'off');
	} catch {
		// ignore (private mode etc)
	}
}

export function getSoundEnabled(): boolean {
	return isSoundEnabled();
}

function ping(): void {
	if (!isSoundEnabled()) return;
	try {
		audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
		const ctx = audioCtx;
		const now = ctx.currentTime;
		// Two short tones: 880 Hz then 1320 Hz, each ~120ms with a quick fade.
		[
			{ freq: 880, start: 0 },
			{ freq: 1320, start: 0.14 }
		].forEach(({ freq, start }) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.0001, now + start);
			gain.gain.exponentialRampToValueAtTime(0.12, now + start + 0.015);
			gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.14);
			osc.connect(gain).connect(ctx.destination);
			osc.start(now + start);
			osc.stop(now + start + 0.16);
		});
	} catch {
		// Audio may be blocked until first user interaction. That's fine — we
		// just skip this ping silently rather than spamming the console.
	}
}

/**
 * Refresh every indicator from the server-provided unread total.
 * The layout calls this after each load() (initial + invalidateAll
 * triggered by the activity SSE) so badges always reflect the DB state.
 * If the count went UP relative to last call, also fire the ping.
 */
export function setUnreadTotal(n: number, options: { silent?: boolean } = {}): void {
	const went_up = n > unread;
	unread = Math.max(0, n);
	setTitleBadge(unread);
	setFaviconBadge(unread);
	setOSBadge(unread);
	if (went_up && !options.silent) ping();
}

/**
 * Legacy hook: bump the counter by one without consulting the server.
 * Kept for backwards compatibility with code paths that don't yet have
 * an unread total available. New code should prefer setUnreadTotal.
 */
export function notifyActivity(): void {
	setUnreadTotal(unread + 1);
}

/**
 * Clear all indicators. Wire this to window focus and to user actions
 * that imply "I've seen the new stuff" (clicking the inbox, opening a
 * ticket, …).
 */
export function clearActivity(): void {
	if (unread === 0) return;
	unread = 0;
	setTitleBadge(0);
	setFaviconBadge(0);
	setOSBadge(0);
}

/**
 * Wire up the global focus listener once. Call from +layout.svelte's
 * onMount.
 */
export function installActivityListeners(): void {
	if (typeof window === 'undefined') return;
	window.addEventListener('focus', clearActivity);
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) clearActivity();
	});
}
