import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { assertSameOriginJson } from '$lib/server/csrf';
import { rateLimit } from '$lib/server/rateLimit';
import {
	assertPasskeysEnabled,
	MAX_PASSKEYS_PER_USER,
	countPasskeys,
	credentialsForUser,
	relyingParty,
	setChallengeCookie,
	storeChallenge,
	userHandle
} from '$lib/server/passkeys';

/** POST /api/passkeys/register/options -> WebAuthn creation options for the signed-in user. */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
	assertPasskeysEnabled();
	if (!locals.user) throw error(401, 'Unauthorized');
	assertSameOriginJson(request, url);

	const rl = rateLimit(`passkey-register:user:${locals.user.id}`, 10, 60);
	if (!rl.ok) throw error(429, 'Too many attempts, try again shortly.');
	if (countPasskeys(locals.user.id) >= MAX_PASSKEYS_PER_USER) {
		throw error(409, `You already have ${MAX_PASSKEYS_PER_USER} passkeys. Remove one first.`);
	}

	const rp = relyingParty(url);
	const options = await generateRegistrationOptions({
		rpName: rp.rpName,
		rpID: rp.rpID,
		userName: locals.user.email,
		userDisplayName: locals.user.email,
		userID: Buffer.from(userHandle(locals.user.id), 'base64url'),
		attestationType: 'none',
		excludeCredentials: credentialsForUser(locals.user.id),
		// Discoverable credential with user verification: signing in needs no
		// username and the passkey itself counts as two factors.
		authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
	});

	setChallengeCookie(cookies, storeChallenge('register', options.challenge, locals.user.id));
	return json(options, { headers: { 'Cache-Control': 'no-store' } });
};
