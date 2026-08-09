import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { transcribeQueueDepth } from '$lib/server/transcribe';

/**
 * GET /api/metrics
 * Prometheus text-format exposition. Public on purpose so Prometheus,
 * Uptime Kuma, or any scraper can hit it without auth. The numbers are
 * cheap counts/gauges; no sensitive data leaves the process.
 *
 * For air-gapped deployments where even counts are sensitive, gate this
 * endpoint behind your reverse proxy.
 */
export const GET: RequestHandler = () => {
	const row = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
	const open = row("SELECT COUNT(*) AS n FROM tickets WHERE status='open' AND archived_at IS NULL");
	const pending = row(
		"SELECT COUNT(*) AS n FROM tickets WHERE status='pending' AND archived_at IS NULL"
	);
	const closed = row("SELECT COUNT(*) AS n FROM tickets WHERE status='closed'");
	const archived = row('SELECT COUNT(*) AS n FROM tickets WHERE archived_at IS NOT NULL');
	const urgent = row(
		"SELECT COUNT(*) AS n FROM tickets WHERE priority='urgent' AND status<>'closed' AND archived_at IS NULL"
	);
	const messages = row('SELECT COUNT(*) AS n FROM messages');
	const attachments = row('SELECT COUNT(*) AS n FROM attachments');
	const totalBytes = (
		db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM attachments').get() as { n: number }
	).n;
	const users = row('SELECT COUNT(*) AS n FROM users');
	const admins = row("SELECT COUNT(*) AS n FROM users WHERE role='admin'");
	const sessions = row('SELECT COUNT(*) AS n FROM sessions');
	const pendingMagic = row('SELECT COUNT(*) AS n FROM magic_links WHERE used_at IS NULL');

	// Transcription counters — derived from attachment transcript_status column.
	const transcriptReady = row("SELECT COUNT(*) AS n FROM attachments WHERE transcript_status='ready'");
	const transcriptPending = row(
		"SELECT COUNT(*) AS n FROM attachments WHERE transcript_status='pending'"
	);
	const transcriptFailed = row(
		"SELECT COUNT(*) AS n FROM attachments WHERE transcript_status='failed'"
	);
	const queueDepth = transcribeQueueDepth();

	const body = [
		'# HELP hilo_tickets Tickets by status.',
		'# TYPE hilo_tickets gauge',
		`hilo_tickets{status="open"} ${open}`,
		`hilo_tickets{status="pending"} ${pending}`,
		`hilo_tickets{status="closed"} ${closed}`,
		`hilo_tickets{status="archived"} ${archived}`,
		'# HELP hilo_tickets_urgent Tickets with priority=urgent and not closed/archived.',
		'# TYPE hilo_tickets_urgent gauge',
		`hilo_tickets_urgent ${urgent}`,
		'# HELP hilo_messages_total Total messages ever recorded.',
		'# TYPE hilo_messages_total counter',
		`hilo_messages_total ${messages}`,
		'# HELP hilo_attachments_total Total attachments stored.',
		'# TYPE hilo_attachments_total counter',
		`hilo_attachments_total ${attachments}`,
		'# HELP hilo_attachments_bytes Total bytes stored on disk by attachments.',
		'# TYPE hilo_attachments_bytes gauge',
		`hilo_attachments_bytes ${totalBytes}`,
		'# HELP hilo_users Users in the system.',
		'# TYPE hilo_users gauge',
		`hilo_users{role="any"} ${users}`,
		`hilo_users{role="admin"} ${admins}`,
		'# HELP hilo_sessions Active session rows.',
		'# TYPE hilo_sessions gauge',
		`hilo_sessions ${sessions}`,
		'# HELP hilo_magic_links_pending Magic-link tokens generated and not yet consumed.',
		'# TYPE hilo_magic_links_pending gauge',
		`hilo_magic_links_pending ${pendingMagic}`,
		'# HELP hilo_uptime_seconds Process uptime.',
		'# TYPE hilo_uptime_seconds gauge',
		`hilo_uptime_seconds ${Math.floor(process.uptime())}`,
		'# HELP hilo_transcribe_queue_depth Whisper transcription jobs currently in-flight or queued.',
		'# TYPE hilo_transcribe_queue_depth gauge',
		`hilo_transcribe_queue_depth ${queueDepth}`,
		'# HELP hilo_transcripts_total Attachments with a completed transcript by outcome.',
		'# TYPE hilo_transcripts_total counter',
		`hilo_transcripts_total{status="ready"} ${transcriptReady}`,
		`hilo_transcripts_total{status="pending"} ${transcriptPending}`,
		`hilo_transcripts_total{status="failed"} ${transcriptFailed}`,
		''
	].join('\n');

	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }
	});
};
