import type { Handle } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { SESSION_COOKIE, getSessionUser } from '$lib/server/auth';
import { authenticateToken } from '$lib/server/apiTokens';
import { parseBearer } from '$lib/server/tokenCrypto';
import { passwordGate } from '$lib/server/passwordGate';
import { loginUrlWithNext } from '$lib/server/nav';
import { log } from '$lib/server/logger';
import { PROD } from '$lib/server/utils';
import { startMailWorker, stopMailWorker } from '$lib/server/mailQueue';
import { startReminderWorker, stopReminderWorker } from '$lib/server/reminders';
import { startImapPoller, stopImapPoller } from '$lib/server/imap';
import { startCleanupWorker, stopCleanupWorker } from '$lib/server/cleanup';
import { backfillSilenceFlags } from '$lib/server/audioSilence';
import { db } from '$lib/server/db';
import { setMailer, NodemailerMailer, MemoryMailer } from '$lib/server/mailer';
import { setStorage, LocalFsStorage } from '$lib/server/storage';
import { config } from '$lib/server/env';

// Wire dependencies once. The mailer + storage are injected so swapping
// Nodemailer for Postmark/SES (or LocalFs for S3) later means writing a
// new adapter, nothing else.
//
// SMTP_DRYRUN=1 activates the in-memory mailer — emails are logged but not
// sent. Used by the local staging stack so tests never hit real SMTP.
if (process.env.SMTP_DRYRUN === '1') {
	setMailer(new MemoryMailer());
} else {
	setMailer(
		new NodemailerMailer({
			host: config.smtp.host,
			port: config.smtp.port,
			secure: config.smtp.secure,
			user: config.smtp.user,
			pass: config.smtp.pass
		})
	);
}
setStorage(new LocalFsStorage(config.uploadDir));

// Background workers boot on the first request. Idempotent — each `start*`
// guards itself, so additional imports / restarts don't spawn duplicates.
startMailWorker();
startReminderWorker();
startImapPoller();
startCleanupWorker();
// Flag voice recordings that hold no sound (idempotent, a handful of rows).
setTimeout(() => backfillSilenceFlags(), 5_000).unref();

// ─── Graceful shutdown ──────────────────────────────────────────────────────
// Docker sends SIGTERM with a 10s default grace window before SIGKILL. We use
// it to drain the timers, flush any pending mail, and close the SQLite handle
// cleanly (so WAL checkpoint runs, leaving the file in a recoverable state).
//
// Idempotent: the `shuttingDown` flag stops double-firing if both SIGTERM and
// SIGINT arrive (Ctrl-C during `docker compose down`, for example).
let shuttingDown = false;
async function gracefulShutdown(signal: NodeJS.Signals): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	log.info('shutdown signal received', { signal });
	try {
		stopMailWorker();
		stopReminderWorker();
		stopImapPoller();
		stopCleanupWorker();
		// Final WAL checkpoint + close. Safe even if the DB is already idle.
		try {
			db.pragma('wal_checkpoint(TRUNCATE)');
			db.close();
		} catch (err) {
			log.warn('db close failed', { error: (err as Error).message });
		}
		log.info('shutdown clean, exiting');
	} finally {
		// Give the logger a tick to flush stdout before the process exits.
		setTimeout(() => process.exit(0), 50).unref();
	}
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

/**
 * Per-request middleware:
 *   1. Resolve the session into `event.locals.user`.
 *   2. Stamp the theme into `<html data-theme>` so SSR matches the user's
 *      preference without a client-side flash.
 *   3. Add conservative security headers (CSP, HSTS in prod, sniff guard).
 *   4. Emit one structured access log per request.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const sid = event.cookies.get(SESSION_COOKIE);
	event.locals.user = getSessionUser(sid);

	// Agent API tokens: honoured ONLY on /api/v1/*. Anywhere else the app keeps
	// requiring a browser session, so a leaked token (even an admin's) cannot
	// reach admin or account endpoints.
	let earlyResponse: Response | null = null;
	const bearer = parseBearer(event.request.headers.get('authorization'));
	if (bearer) {
		if (!event.url.pathname.startsWith('/api/v1/')) {
			earlyResponse = new Response(
				JSON.stringify({ error: 'API tokens can only be used on /api/v1/*' }),
				{ status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
			);
		} else {
			const auth = authenticateToken(bearer);
			if (!auth) {
				earlyResponse = new Response(JSON.stringify({ error: 'Invalid, expired or revoked token' }), {
					status: 401,
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-store',
						'WWW-Authenticate': 'Bearer realm="hilo"'
					}
				});
			} else {
				event.locals.user = auth.user;
				event.locals.apiToken = auth.info;
			}
		}
	}
	// A temporary password must be replaced before anything else is reachable.
	if (!earlyResponse && event.locals.user?.mustChangePassword && !event.locals.apiToken) {
		const gate = passwordGate(event.url.pathname, event.request.method);
		if (gate === 'redirect') {
			earlyResponse = new Response(null, {
				status: 303,
				headers: { Location: '/change-password', 'Cache-Control': 'no-store' }
			});
		} else if (gate === 'block') {
			earlyResponse = new Response(JSON.stringify({ error: 'password_change_required' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
			});
		}
	}
	const theme = event.locals.user?.theme ?? 'dark';
	const accent = event.locals.user?.accent ?? 'violet';
	const reqId = event.request.headers.get('x-request-id') || randomUUID();
	const started = performance.now();

	const response =
		earlyResponse ??
		(await resolve(event, {
			transformPageChunk: ({ html }) =>
				html.replace('%hilo.theme%', theme).replace('%hilo.accent%', accent)
		}));

	// A page that needs a session redirects to /login: remember where the person was
	// going (an email link, a bookmark) so they land there after signing in.
	if (
		!event.locals.user &&
		event.request.method === 'GET' &&
		(response.status === 302 || response.status === 303) &&
		response.headers.get('location') === '/login'
	) {
		response.headers.set('location', loginUrlWithNext(event.url.pathname + event.url.search));
	}

	// Service workers must never be served from a CDN cache — the browser
	// compares the byte-for-byte response to detect updates, and a stale
	// cached SW will prevent installs and push-subscription renewals.
	if (event.url.pathname === '/sw.js') {
		response.headers.set('Cache-Control', 'no-store');
	}

	// Security headers.
	// CSP is permissive (Sprint31 baseline) — strict nonce-based CSP is a
	// future security sprint. `unsafe-inline` is required by SvelteKit
	// hydration. Cloudflare injects beacon.min.js + cdn-cgi challenge scripts;
	// those origins are allowed here so they don't produce console violations
	// that tank Lighthouse Best Practices.
	response.headers.set('X-Content-Type-Options', 'nosniff');
	// Pages that carry a secret in the URL (e.g. /set-password) set a stricter
	// policy themselves; do not overwrite it.
	if (!response.headers.has('Referrer-Policy')) {
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	}
	response.headers.set('X-Frame-Options', 'DENY');
	// Microphone is allowed for the same origin only so the composer's
	// voice-message recorder and dictation buttons can call
	// `navigator.mediaDevices.getUserMedia({ audio: true })`. Without the
	// `(self)` allow-list the browser rejects the request with
	// `NotAllowedError` silently — the button appears to do nothing.
	// Camera, geolocation, payment, and the experimental topics APIs stay
	// fully disabled: we never use them and explicit refusal blocks any
	// future drive-by attempt to opt in.
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(self), geolocation=(), payment=(), interest-cohort=(), browsing-topics=()'
	);
	response.headers.set('X-Request-Id', reqId);
	if (PROD) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	// Skip CSP on SSE — `Content-Type: text/event-stream` plus CSP confuses
	// some proxies and the stream contains no HTML anyway.
	if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
		response.headers.set(
			'Content-Security-Policy',
			[
				`default-src 'self'`,
				// 'unsafe-eval' added for SvelteKit dev HMR; no-op in prod.
				// Cloudflare cdn-cgi challenge scripts need 'unsafe-eval' to run.
				`script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com`,
				`style-src 'self' 'unsafe-inline'`,
				`img-src 'self' data: blob: https://www.gravatar.com`,
				// `media-src` covers <audio> and <video>. We need `blob:` so
				// the composer's voice-message preview can play the
				// just-recorded blob URL before send, and `'self'` so the
				// chat bubbles can play attachments served from
				// /api/attachments. Without this rule the browser falls
				// back to default-src 'self' and silently rejects blob:
				// URLs with "Media load rejected by URL safety check",
				// which is exactly how the preview chip was broken.
				`media-src 'self' blob:`,
				`font-src 'self' data:`,
				// wss: for future WebSocket support; cloudflareinsights for beacon.
				`connect-src 'self' wss: https://cloudflareinsights.com`,
				`manifest-src 'self'`,
				`worker-src 'self'`,
				`frame-ancestors 'none'`,
				`base-uri 'self'`,
				`form-action 'self'`
			].join('; ')
		);
	}

	const tookMs = Math.round(performance.now() - started);
	log.info('http', {
		req_id: reqId,
		method: event.request.method,
		path: event.url.pathname,
		status: response.status,
		took_ms: tookMs,
		user_id: event.locals.user?.id ?? null
	});

	return response;
};
