import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { config } from '$lib/server/env';

/**
 * Operator-only diagnostic page. Lit only when `HILO_DEV_PANEL=1` is set
 * in the environment; gated by the admin role.
 */
export const load: PageServerLoad = ({ locals }) => {
	if (process.env.HILO_DEV_PANEL !== '1') throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const counts = {
		users: (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n,
		sessions: (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n,
		tickets: (db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }).n,
		messages: (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n,
		attachments: (db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n,
		reactions: (db.prepare('SELECT COUNT(*) AS n FROM reactions').get() as { n: number }).n,
		audit: (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n,
		fts: (db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n,
		outbox_pending: (
			db
				.prepare('SELECT COUNT(*) AS n FROM email_outbox WHERE sent_at IS NULL')
				.get() as { n: number }
		).n,
		outbox_sent: (
			db
				.prepare('SELECT COUNT(*) AS n FROM email_outbox WHERE sent_at IS NOT NULL')
				.get() as { n: number }
		).n
	};

	const env = {
		node_version: process.version,
		uptime_seconds: Math.floor(process.uptime()),
		pid: process.pid,
		brand: config.brand,
		base_url: config.publicBaseUrl,
		smtp_host: config.smtp.host,
		smtp_user: config.smtp.user,
		smtp_from: config.smtp.from,
		auth_dynamic_format: config.authDynamicFormat,
		max_upload_mb: config.maxUploadMb,
		upload_dir: config.uploadDir,
		database_path: config.databasePath,
		imap_configured: !!process.env.IMAP_HOST,
		vapid_configured: !!process.env.VAPID_PUBLIC_KEY,
		sentry_configured: !!process.env.SENTRY_DSN,
		cleanup_worker: (process.env.HILO_CLEANUP_WORKER ?? '1') === '1'
	};

	const memory = process.memoryUsage();

	return { counts, env, memory };
};
