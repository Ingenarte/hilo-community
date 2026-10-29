import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { createSession } from '$lib/server/auth';
import { audit } from '$lib/server/audit';
import { setSessionCookie } from '$lib/server/cookies';
import { assertSameOriginJson } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { classifyDevice } from '$lib/server/device';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import {
	assertPasskeysEnabled,
	CHALLENGE_COOKIE,
	clearChallengeCookie,
	consumeChallenge,
	findPasskey,
	relyingParty,
	touchPasskey,
	userHandle
} from '$lib/server/passkeys';

const FAIL = () => json({ error: 'sign_in_failed' }, { status: 400 });

/** POST /api/passkeys/login/verify { response } -> starts a session when the assertion is valid. */
export const POST: RequestHandler = async ({ request, url, cookies, getClientAddress }) => {
	assertPasskeysEnabled();
	assertSameOriginJson(request, url);
	const ip = clientIp(request.headers, getClientAddress);
	const rl = rateLimit(`passkey-login-verify:${ip}`, 10, 300);
	if (!rl.ok) throw error(429, `Too many attempts. Try again in ${rl.retryAfterSeconds}s.`);

	const stored = consumeChallenge(cookies.get(CHALLENGE_COOKIE), 'login');
	clearChallengeCookie(cookies);
	if (!stored) return FAIL();

	const body = (await request.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null;
	const assertion = body?.response;
	if (!assertion || typeof assertion.id !== 'string') return FAIL();

	const passkey = findPasskey(assertion.id);
	if (!passkey) return FAIL();

	const user = db
		.prepare('SELECT id, disabled_at FROM users WHERE id = ?')
		.get(passkey.user_id) as { id: number; disabled_at: number | null } | undefined;
	if (!user || user.disabled_at) return FAIL();

	// A discoverable credential reports whose it is: it must match the owner.
	const claimedHandle = assertion.response.userHandle;
	if (claimedHandle && claimedHandle !== userHandle(user.id)) return FAIL();

	const rp = relyingParty(url);
	let verification;
	try {
		verification = await verifyAuthenticationResponse({
			response: assertion,
			expectedChallenge: stored.challenge,
			expectedOrigin: rp.origin,
			expectedRPID: rp.rpID,
			credential: {
				id: passkey.credential_id,
				publicKey: Buffer.from(passkey.public_key, 'base64url'),
				counter: passkey.counter,
				transports: passkey.transports ? (JSON.parse(passkey.transports) as string[]) : undefined
			},
			requireUserVerification: true
		});
	} catch {
		return FAIL();
	}
	if (!verification.verified) return FAIL();

	touchPasskey(
		passkey.id,
		verification.authenticationInfo.newCounter,
		verification.authenticationInfo.credentialBackedUp
	);
	db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(user.id);

	const sid = createSession(user.id, classifyDevice(request.headers, url));
	setSessionCookie(cookies, sid, { remember: true });
	audit('user.login_passkey', { target: `user:${user.id}`, detail: { passkey_id: passkey.id } });
	return json({ ok: true });
};
