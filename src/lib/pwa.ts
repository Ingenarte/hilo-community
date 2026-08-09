/**
 * Standalone-mode detection helper. Single source of truth used by
 * InstallButton (to hide the install affordance) and HelpButton (to skip
 * the auto-open on first login when the app is already installed).
 */

/**
 * Returns true when the app is running as an installed PWA in standalone
 * display mode. False in a normal browser tab, or during SSR.
 *
 * Detection strategy:
 *   - CSS media query `(display-mode: standalone)` covers Chrome/Edge/Firefox
 *     PWAs on all platforms.
 *   - `navigator.standalone` is a non-standard but reliable iOS Safari signal
 *     that predates the media-query approach. Required for iOS < 16.4.
 */
export function detectStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	const mq = window.matchMedia('(display-mode: standalone)').matches;
	// @ts-expect-error -- non-standard but present on iOS Safari
	return mq || !!window.navigator.standalone;
}
