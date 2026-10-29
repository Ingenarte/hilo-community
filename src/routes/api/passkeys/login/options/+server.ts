import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { assertSameOriginJson } from '$lib/server/csrf';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import {
	assertPasskeysEnabled,
	relyingParty,
	setChallengeCookie,
	storeChallenge
} from '$lib/server/passkeys';

/**
 * POST /api/passkeys/login/options -> WebAuthn request options for a
 * usernameless sign-in (the authenticator picks the discoverable credential).
 */
export const POST: RequestHandler = async ({ request, url, cookies, getClientAddress }) => {
	assertPasskeysEnabled();
	assertSameOriginJson(request, url);
	const ip = clientIp(request.headers, getClientAddress);
	const rl = rateLimit(`passkey-login-options:${ip}`, 20, 300);
	if (!rl.ok) throw error(429, `Too many attempts. Try again in ${rl.retryAfterSeconds}s.`);

	const options = await generateAuthenticationOptions({
		rpID: relyingParty(url).rpID,
		userVerification: 'required'
	});
	setChallengeCookie(cookies, storeChallenge('login', options.challenge, null));
	return json(options, { headers: { 'Cache-Control': 'no-store' } });
};
