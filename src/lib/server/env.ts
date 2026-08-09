/**
 * Centralized typed access to environment variables.
 * All runtime config is read once at module load time.
 */
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';

function required(key: string, value: string | undefined): string {
	if (!value || value.trim() === '') {
		throw new Error(`Missing required env var: ${key}`);
	}
	return value;
}

export const config = {
	publicBaseUrl: pubEnv.PUBLIC_BASE_URL || 'http://localhost:5180',
	brand: pubEnv.PUBLIC_BRAND || 'Hilo',

	adminEmail: required('ADMIN_EMAIL', env.ADMIN_EMAIL).toLowerCase().trim(),

	authFixedPassword: required('AUTH_FIXED_PASSWORD', env.AUTH_FIXED_PASSWORD),
	// Optional separate password for the admin account. If unset, admin uses
	// the same `authFixedPassword` as everyone else.
	authAdminFixedPassword: env.AUTH_ADMIN_FIXED_PASSWORD || env.AUTH_FIXED_PASSWORD || '',
	// Format of the date-derived "dynamic code" the operator hands out. Use
	// any combo of `dd`/`mm`/`yy`/`yyyy` (e.g. `ddmmyy`, `mmddyyyy`, `yymmdd`).
	// Set to `none` to disable the dynamic code entirely (only the fixed
	// password matters).
	authDynamicFormat: (env.AUTH_DYNAMIC_FORMAT || 'ddmmyy').toLowerCase(),
	// ±N days tolerated to absorb timezone drift. Set to 0 to require an
	// exact match to the server-local date.
	authDynamicWindowDays: Math.max(0, Number(env.AUTH_DYNAMIC_WINDOW_DAYS ?? 1)),
	sessionSecret: required('SESSION_SECRET', env.SESSION_SECRET),

	smtp: {
		host: env.SMTP_HOST || 'smtp.gmail.com',
		port: Number(env.SMTP_PORT || 465),
		secure: (env.SMTP_SECURE || 'true').toLowerCase() === 'true',
		user: required('SMTP_USER', env.SMTP_USER),
		pass: required('SMTP_PASS', env.SMTP_PASS),
		from: env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com'
	},

	// Default raised from 20 MB to 500 MB in Sprint 33 (chunked upload support).
	// The 100 MB CF Tunnel single-request ceiling is enforced at the chunk level;
	// total upload size can reach up to this value via the tus.io chunked path.
	maxUploadMb: Number(env.MAX_UPLOAD_MB || 500),
	uploadDir: env.UPLOAD_DIR || './uploads',
	// Retention policy for uploaded files. Default changed from null (keep forever)
	// to 180 days in Sprint 33. Set to 0 or leave empty to keep forever.
	uploadRetainDays: Number(env.UPLOAD_RETAIN_DAYS || 180) || 180,
	databasePath: env.DATABASE_PATH || './data/hilo.db',

	// Whisper sidecar — transcription service reached by container name inside
	// the compose network. Falls back to localhost for local dev without the
	// sidecar running.
	whisperUrl: env.WHISPER_URL || 'http://localhost:8000',
	whisperModel: env.WHISPER_MODEL || 'Systran/faster-whisper-base',
	whisperMaxConcurrent: Math.max(1, Number(env.WHISPER_MAX_CONCURRENT || 1))
};

export type Config = typeof config;
