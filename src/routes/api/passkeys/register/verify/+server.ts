import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { audit } from '$lib/server/audit';
import { assertSameOriginJson } from '$lib/server/csrf';
import { rateLimit } from '$lib/server/rateLimit';
import {
	assertPasskeysEnabled,
	CHALLENGE_COOKIE,
	MAX_PASSKEYS_PER_USER,
	addPasskey,
	cleanName,
	clearChallengeCookie,
	consumeChallenge,
	countPasskeys,
	findPasskey,
	relyingParty
} from '$lib/server/passkeys';

/** POST /api/passkeys/register/verify { response, name } -> stores the new passkey. */
export const POST: RequestHandler = async ({ locals, request, url, cookies }) => {
	assertPasskeysEnabled();
	if (!locals.user) throw error(401, 'Unauthorized');
	assertSameOriginJson(request, url);

	const rl = rateLimit(`passkey-register:user:${locals.user.id}`, 10, 60);
	if (!rl.ok) throw error(429, 'Too many attempts, try again shortly.');

	const stored = consumeChallenge(cookies.get(CHALLENGE_COOKIE), 'register');
	clearChallengeCookie(cookies);
	if (!stored || stored.userId !== locals.user.id) {
		return json({ error: 'challenge_expired' }, { status: 400 });
	}

	const body = (await request.json().catch(() => null)) as {
		response?: RegistrationResponseJSON;
		name?: unknown;
	} | null;
	if (!body?.response) return json({ error: 'bad_request' }, { status: 400 });
	if (countPasskeys(locals.user.id) >= MAX_PASSKEYS_PER_USER) {
		return json({ error: 'too_many_passkeys' }, { status: 409 });
	}

	const rp = relyingParty(url);
	let verification;
	try {
		verification = await verifyRegistrationResponse({
			response: body.response,
			expectedChallenge: stored.challenge,
			expectedOrigin: rp.origin,
			expectedRPID: rp.rpID,
			requireUserVerification: true
		});
	} catch {
		return json({ error: 'verification_failed' }, { status: 400 });
	}
	if (!verification.verified || !verification.registrationInfo) {
		return json({ error: 'verification_failed' }, { status: 400 });
	}

	const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
	if (findPasskey(credential.id)) return json({ error: 'already_registered' }, { status: 409 });

	const id = addPasskey({
		userId: locals.user.id,
		credentialId: credential.id,
		publicKey: Buffer.from(credential.publicKey).toString('base64url'),
		counter: credential.counter,
		transports: body.response.response.transports,
		deviceType: credentialDeviceType,
		backedUp: credentialBackedUp,
		name: cleanName(body.name)
	});
	audit('passkey.registered', {
		actor: locals.user,
		target: `passkey:${id}`,
		detail: { device_type: credentialDeviceType, synced: credentialBackedUp }
	});
	return json({ ok: true, id }, { status: 201 });
};
