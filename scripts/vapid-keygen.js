#!/usr/bin/env node
/**
 * Hilo · VAPID keypair generator.
 *
 * Prints a fresh P-256 keypair in base64url, ready to drop into .env:
 *
 *   node scripts/vapid-keygen.js
 *
 * Add `VAPID_PUBLIC_KEY=...` and `VAPID_PRIVATE_KEY=...` to .env, restart.
 * Web Push activates automatically once both are set.
 */

import { createECDH } from 'node:crypto';

function b64u(b) {
	return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();

const publicKey = b64u(ecdh.getPublicKey()); // 65-byte uncompressed
const privateKey = b64u(ecdh.getPrivateKey());

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('');
console.log('# Paste the two lines above into .env and restart Hilo.');
console.log('# The public key is also exposed at GET /api/push/public-key.');
