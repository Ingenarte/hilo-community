// Browser side of passkeys (WebAuthn). Client-only: import from components.
import {
	browserSupportsWebAuthn,
	platformAuthenticatorIsAvailable,
	startAuthentication,
	startRegistration
} from '@simplewebauthn/browser';

export { browserSupportsWebAuthn, platformAuthenticatorIsAvailable };

export type PasskeyResult = { ok: true } | { ok: false; error: string; cancelled?: boolean };

async function postJson(url: string, body: unknown = {}): Promise<Response> {
	return fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

/** A friendly default label for the device creating the passkey. */
export function defaultPasskeyName(): string {
	const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
	if (/iPhone/i.test(ua)) return 'iPhone';
	if (/iPad/i.test(ua)) return 'iPad';
	if (/Android/i.test(ua)) return 'Android phone';
	if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
	if (/Windows/i.test(ua)) return 'Windows PC';
	if (/Linux|X11/i.test(ua)) return 'Linux PC';
	return 'This device';
}

function describe(err: unknown): PasskeyResult {
	const name = err instanceof Error ? err.name : '';
	if (name === 'NotAllowedError' || name === 'AbortError') {
		return { ok: false, error: 'The request was cancelled or timed out.', cancelled: true };
	}
	if (name === 'InvalidStateError') {
		return { ok: false, error: 'This device already has a passkey for your account.' };
	}
	return { ok: false, error: 'Passkeys are not available here. Use your password instead.' };
}

/** Create a passkey for the signed-in user. */
export async function registerPasskey(name: string = defaultPasskeyName()): Promise<PasskeyResult> {
	if (!browserSupportsWebAuthn()) {
		return { ok: false, error: 'This browser does not support passkeys.' };
	}
	try {
		const optRes = await postJson('/api/passkeys/register/options');
		if (!optRes.ok) {
			const msg = optRes.status === 409 ? 'You already have the maximum number of passkeys.' : null;
			return { ok: false, error: msg ?? 'Could not start passkey setup. Please try again.' };
		}
		const optionsJSON = await optRes.json();
		const response = await startRegistration({ optionsJSON });
		const res = await postJson('/api/passkeys/register/verify', { response, name });
		if (res.ok) return { ok: true };
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		return {
			ok: false,
			error:
				body.error === 'already_registered'
					? 'That passkey is already registered.'
					: 'The passkey could not be verified. Please try again.'
		};
	} catch (err) {
		return describe(err);
	}
}

/** Sign in without a password. On success the session cookie is already set. */
export async function signInWithPasskey(): Promise<PasskeyResult> {
	if (!browserSupportsWebAuthn()) {
		return { ok: false, error: 'This browser does not support passkeys.' };
	}
	try {
		const optRes = await postJson('/api/passkeys/login/options');
		if (!optRes.ok) {
			return {
				ok: false,
				error: optRes.status === 429 ? 'Too many attempts. Try again in a few minutes.' : 'Could not start sign-in.'
			};
		}
		const optionsJSON = await optRes.json();
		const response = await startAuthentication({ optionsJSON });
		const res = await postJson('/api/passkeys/login/verify', { response });
		if (res.ok) return { ok: true };
		return { ok: false, error: 'That passkey was not recognised. Use your password instead.' };
	} catch (err) {
		return describe(err);
	}
}
