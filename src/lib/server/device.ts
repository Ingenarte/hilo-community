/**
 * Classify the device on the other side of a request.
 *
 * Three signals, in order of trust:
 *   1. `Sec-CH-UA-Mobile` / `Sec-CH-UA-Platform` Client Hints (Chromium 89+).
 *      Browser tells us authoritatively if it considers itself mobile and
 *      what OS it's on. Safari and Firefox do not send these — fallback
 *      to the User-Agent string.
 *   2. `User-Agent` substring sniffing. Imperfect (UAs lie) but covers
 *      Safari + Firefox + older browsers. Four patterns, no third-party
 *      parser library — saves the dependency weight for a use case where
 *      we don't need browser version, just the form factor.
 *   3. `?source=pwa` on the navigation URL. The manifest's `start_url` is
 *      `/tickets?source=pwa` — when the user launches the installed PWA
 *      from their home screen, that param rides along. Distinguishes
 *      "PWA installed" from "browser tab".
 *
 * Result is captured ONLY at session creation. Per-request UA parsing
 * was deliberately avoided — `getSessionUser` already runs on every HTTP
 * request and we just throttled its write hot-path; adding device
 * fingerprinting there would undo that.
 */

export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type DisplayMode = 'browser' | 'pwa';
export type OsHint = 'iOS' | 'Android' | 'macOS' | 'Windows' | 'Linux' | 'other';

export type DeviceInfo = {
	userAgent: string; // truncated to 255 chars (we don't index it, no need for full)
	deviceClass: DeviceClass;
	displayMode: DisplayMode;
	osHint: OsHint;
};

export function classifyDevice(headers: Headers, url?: URL | null): DeviceInfo {
	const ua = (headers.get('user-agent') ?? '').slice(0, 255);
	const chMobile = headers.get('sec-ch-ua-mobile'); // '?1' | '?0' | null
	const chPlatform = (headers.get('sec-ch-ua-platform') ?? '').replace(/^"|"$/g, '');

	let deviceClass: DeviceClass;
	if (chMobile === '?1') {
		// Browser self-reports mobile. Distinguish tablet via UA hint.
		deviceClass = /\bTablet\b|iPad/i.test(ua) ? 'tablet' : 'mobile';
	} else if (chMobile === '?0') {
		deviceClass = 'desktop';
	} else if (/\bTablet\b|iPad/i.test(ua)) {
		deviceClass = 'tablet';
	} else if (/Mobi|Android|iPhone|iPod/i.test(ua)) {
		deviceClass = 'mobile';
	} else {
		deviceClass = 'desktop';
	}

	let osHint: OsHint;
	if (chPlatform) {
		const p = chPlatform.toLowerCase();
		if (p.startsWith('ios')) osHint = 'iOS';
		else if (p.startsWith('android')) osHint = 'Android';
		else if (p.startsWith('macos')) osHint = 'macOS';
		else if (p.startsWith('windows')) osHint = 'Windows';
		else if (p.startsWith('linux')) osHint = 'Linux';
		else osHint = 'other';
	} else if (/iPhone|iPad|iPod/.test(ua)) osHint = 'iOS';
	else if (/Android/.test(ua)) osHint = 'Android';
	else if (/Mac OS X/.test(ua)) osHint = 'macOS';
	else if (/Windows/.test(ua)) osHint = 'Windows';
	else if (/Linux/.test(ua)) osHint = 'Linux';
	else osHint = 'other';

	const displayMode: DisplayMode =
		url?.searchParams.get('source') === 'pwa' ? 'pwa' : 'browser';

	return { userAgent: ua, deviceClass, displayMode, osHint };
}
