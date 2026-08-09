/**
 * Tiny structured logger. Emits one JSON line per call to stdout/stderr so
 * journald, Docker, or any log shipper can parse it without configuration.
 *
 * Why not pino? Two reasons: (a) it would be our heaviest dependency, and
 * (b) the format below is deliberately stable and easy to grep. If a user
 * wants structured logging, they get it without paying for a logger they
 * may not need.
 */

import { PROD } from './utils';

type Fields = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

const SHOULD_LOG_DEBUG = !PROD || process.env.HILO_LOG_DEBUG === '1';

// Sentry opt-in: when SENTRY_DSN is set, every error/warn line is also POSTed
// to Sentry's HTTP store API. We avoid the @sentry/node SDK to keep the
// dependency count at two. This works only for plain error envelopes; for
// performance traces / replays use the official SDK.
const SENTRY_DSN = process.env.SENTRY_DSN || '';
const sentryEndpoint = parseSentryDsn(SENTRY_DSN);
function parseSentryDsn(dsn: string): { url: string; auth: string } | null {
	if (!dsn) return null;
	try {
		const u = new URL(dsn);
		const projectId = u.pathname.replace(/^\//, '');
		const publicKey = u.username;
		const host = u.host;
		const url = `${u.protocol}//${host}/api/${projectId}/envelope/`;
		return {
			url,
			auth: `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=hilo/0.4`
		};
	} catch {
		return null;
	}
}

function sentryReport(level: Level, msg: string, fields?: Fields) {
	if (!sentryEndpoint) return;
	if (level !== 'error' && level !== 'warn') return;
	const eventId = Math.random().toString(36).slice(2, 18) + Date.now().toString(36);
	const envelope =
		JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) +
		'\n' +
		JSON.stringify({ type: 'event' }) +
		'\n' +
		JSON.stringify({
			event_id: eventId,
			timestamp: Math.floor(Date.now() / 1000),
			level,
			message: { formatted: msg },
			extra: fields ?? {},
			environment: process.env.NODE_ENV || 'development',
			tags: { service: 'hilo' }
		});
	fetch(sentryEndpoint.url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-sentry-envelope',
			'X-Sentry-Auth': sentryEndpoint.auth
		},
		body: envelope
	}).catch(() => {
		// Reporting failures must not cascade. Silently drop.
	});
}

function emit(level: Level, msg: string, fields?: Fields) {
	if (level === 'debug' && !SHOULD_LOG_DEBUG) return;
	const line = JSON.stringify({
		t: new Date().toISOString(),
		level,
		msg,
		...fields
	});
	if (level === 'error' || level === 'warn') {
		process.stderr.write(line + '\n');
		sentryReport(level, msg, fields);
	} else {
		process.stdout.write(line + '\n');
	}
}

export const log = {
	debug: (msg: string, fields?: Fields) => emit('debug', msg, fields),
	info: (msg: string, fields?: Fields) => emit('info', msg, fields),
	warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
	error: (msg: string, fields?: Fields) => emit('error', msg, fields)
};
