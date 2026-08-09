/**
 * Minimal Web Push (RFC 8030 + 8291 + 8292) sender, dependency-free.
 *
 * Activation: set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in .env (generate
 * once with `node scripts/vapid-keygen.js`). If either is missing, the
 * subscription endpoints reject new subscribers and `sendWebPushToUser`
 * becomes a no-op.
 *
 * Why hand-rolled? Two reasons:
 *   1. Charter: two runtime deps. `web-push` adds another.
 *   2. Educational; the code is short enough to audit.
 *
 * The payload encryption (RFC 8291 aes128gcm scheme) uses Node's built-in
 * `crypto` ECDH + HKDF + AES-128-GCM primitives.
 */

import {
	createECDH,
	createHmac,
	createCipheriv,
	createPrivateKey,
	createSign,
	randomBytes
} from 'node:crypto';
import { db } from './db';
import { log } from './logger';
import { withRetry } from './retry';
import { config } from './env';

export type WebPushPayload = {
	title: string;
	body?: string;
	url?: string;
	tag?: string;
	icon?: string;
};

export function vapidConfigured(): boolean {
	return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string {
	return process.env.VAPID_PUBLIC_KEY ?? '';
}

// ─── Base64URL ──────────────────────────────────────────────────────────────

function b64uEncode(b: Buffer): string {
	return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(s: string): Buffer {
	const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(((s.length + 3) % 4) - 3 || 0);
	return Buffer.from(padded, 'base64');
}

// ─── HKDF (RFC 5869) — Node's built-in is async; this is the sync 4-line version ──
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
	const prk = createHmac('sha256', salt).update(ikm).digest();
	let t = Buffer.alloc(0);
	let result = Buffer.alloc(0);
	let counter = 1;
	while (result.length < length) {
		t = createHmac('sha256', prk)
			.update(Buffer.concat([t, info, Buffer.from([counter])]))
			.digest();
		result = Buffer.concat([result, t]);
		counter += 1;
	}
	return result.subarray(0, length);
}

// ─── VAPID JWT (RFC 8292) ───────────────────────────────────────────────────

function vapidAuthHeader(audience: string, subject: string): string {
	const header = b64uEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const payload = b64uEncode(
		Buffer.from(
			JSON.stringify({
				aud: audience,
				exp: Math.floor(Date.now() / 1000) + 12 * 3600,
				sub: subject
			})
		)
	);
	const signingInput = `${header}.${payload}`;

	// VAPID private key is the raw 32-byte EC `d` scalar; the public key
	// is the uncompressed P-256 point (0x04 || X || Y, 65 bytes — or 64
	// without the leading flag). Rather than assemble PKCS#8 DER by hand
	// (the old encoder had a wrong outer-SEQUENCE length and crashed
	// Node with ERR_OSSL_ASN1_TOO_LONG), import the key via JWK which
	// Node validates and converts internally.
	const privRaw = b64uDecode(process.env.VAPID_PRIVATE_KEY!);
	const pubRaw = b64uDecode(process.env.VAPID_PUBLIC_KEY!);
	const pubBody = pubRaw.length === 65 ? pubRaw.subarray(1) : pubRaw;
	const privateKey = createPrivateKey({
		key: {
			kty: 'EC',
			crv: 'P-256',
			d: privRaw.toString('base64url'),
			x: pubBody.subarray(0, 32).toString('base64url'),
			y: pubBody.subarray(32, 64).toString('base64url')
		},
		format: 'jwk'
	});
	const signer = createSign('SHA256');
	signer.update(signingInput);
	signer.end();
	const der = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
	const sigB64 = b64uEncode(der);
	const jwt = `${signingInput}.${sigB64}`;
	// `k` is the uncompressed public key (65 bytes incl 0x04 flag).
	const kBytes = pubRaw.length === 65 ? pubRaw : Buffer.concat([Buffer.from([0x04]), pubRaw]);
	return `vapid t=${jwt}, k=${b64uEncode(kBytes)}`;
}

// ─── Subscriptions API ─────────────────────────────────────────────────────

export type PushSubscriptionRecord = {
	id: number;
	user_id: number;
	endpoint: string;
	p256dh: string;
	auth: string;
};

export function subscribePush(userId: number, sub: {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}): void {
	db.prepare(
		`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
	).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

export function unsubscribePush(userId: number, endpoint: string): void {
	db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(
		userId,
		endpoint
	);
}

function listForUser(userId: number): PushSubscriptionRecord[] {
	return db
		.prepare('SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
		.all(userId) as PushSubscriptionRecord[];
}

// ─── Send (RFC 8291 aes128gcm) ─────────────────────────────────────────────

function encryptPayload(
	plaintext: Buffer,
	subscriberP256dhRaw: Buffer,
	authSecret: Buffer
): { body: Buffer; salt: Buffer; localPubRaw: Buffer } {
	const ecdh = createECDH('prime256v1');
	ecdh.generateKeys();
	const localPubRaw = ecdh.getPublicKey(); // 65 bytes 0x04||x||y
	const shared = ecdh.computeSecret(subscriberP256dhRaw);

	// PRK_key = HKDF(authSecret, shared, info="WebPush: info\0" || ua_public || as_public, 32)
	const keyInfo = Buffer.concat([
		Buffer.from('WebPush: info\0'),
		subscriberP256dhRaw,
		localPubRaw
	]);
	const ikm = hkdf(authSecret, shared, keyInfo, 32);

	const salt = randomBytes(16);
	const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
	const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

	// Plaintext is padded with one 0x02 delimiter (last record).
	const padded = Buffer.concat([plaintext, Buffer.from([0x02])]);
	const cipher = createCipheriv('aes-128-gcm', cek, nonce);
	const ct = Buffer.concat([cipher.update(padded), cipher.final()]);
	const tag = cipher.getAuthTag();
	const encryptedBlock = Buffer.concat([ct, tag]);

	// aes128gcm header: salt(16) || rs(4 BE) || idlen(1) || keyid(idlen)
	const rs = Buffer.alloc(4);
	rs.writeUInt32BE(4096, 0);
	const header = Buffer.concat([salt, rs, Buffer.from([localPubRaw.length]), localPubRaw]);
	const body = Buffer.concat([header, encryptedBlock]);
	return { body, salt, localPubRaw };
}

async function sendOne(sub: PushSubscriptionRecord, payload: WebPushPayload): Promise<boolean> {
	if (!vapidConfigured()) return false;
	const url = new URL(sub.endpoint);
	const audience = `${url.protocol}//${url.host}`;
	const auth = vapidAuthHeader(audience, `mailto:${config.smtp.from.match(/<([^>]+)>/)?.[1] ?? config.smtp.user}`);

	const subscriberP256dh = b64uDecode(sub.p256dh);
	const authSecret = b64uDecode(sub.auth);
	const ciphertext = encryptPayload(
		Buffer.from(JSON.stringify(payload)),
		subscriberP256dh,
		authSecret
	);

	try {
		const res = await withRetry(
			async () => {
				// Wrap in a Blob to bridge the Buffer ↔ BodyInit typing gap between
				// Node's lib and the DOM types pulled in by SvelteKit.
				const payloadBlob = new Blob([new Uint8Array(ciphertext.body)]);
				const r = await fetch(sub.endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/octet-stream',
						'Content-Encoding': 'aes128gcm',
						TTL: '60',
						Authorization: auth
					},
					body: payloadBlob
				});
				if (r.status === 404 || r.status === 410) {
					// Subscriber gone — clean it up and stop retrying.
					db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
					return r;
				}
				if (r.status >= 500) throw new Error(`push ${r.status}`);
				return r;
			},
			{ attempts: 2, baseDelayMs: 1_000 }
		);
		return res.ok;
	} catch (err) {
		log.warn('webpush send failed', { sub_id: sub.id, error: (err as Error).message });
		return false;
	}
}

export function sendWebPushToUser(userId: number, payload: WebPushPayload): void {
	if (!vapidConfigured()) return;
	const subs = listForUser(userId);
	if (subs.length === 0) return;
	for (const sub of subs) {
		void sendOne(sub, payload);
	}
}
