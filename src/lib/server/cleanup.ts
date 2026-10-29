/**
 * Periodic maintenance: prune expired/used magic_links and remove orphan
 * upload files (no row in `attachments` references them).
 *
 * Designed to be invoked from a script (scripts/cleanup.js) on a weekly cron,
 * OR from a long-lived process at boot. The functions are idempotent and
 * safe to run concurrently with a live server.
 *
 * Retention policy (Phase 5, Sprint 32):
 *   UPLOAD_RETAIN_DAYS env var controls how long attachments are kept.
 *   Default: null (keep forever). When set to a positive integer N, attachments
 *   older than N days are deleted from both the DB row and the file on disk.
 *   Voice notes grow at ~1 MB/min; a year of heavy use can fill the volume.
 *   Set UPLOAD_RETAIN_DAYS=365 to cap growth to roughly one year of history.
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { db } from './db';
import { config } from './env';
import { log } from './logger';
import { pruneAudit } from './audit';
import { removeRendition, renditionName } from './audioRendition';
import { pruneExpiredSessions } from './uploads-chunked';

export type CleanupReport = {
	magicLinksRemoved: number;
	sessionsExpired: number;
	orphanFilesRemoved: number;
	orphanBytesFreed: number;
	ticketsAutoClosed: number;
	auditPruned: number;
	oldAttachmentsRemoved: number;
	uploadSessionsPruned: number;
};

/**
 * Remove magic-link rows that are either:
 *   - past their expires_at, OR
 *   - used more than {usedRetainDays} days ago
 * Default: retain used tokens for 7 days for audit purposes, then drop them.
 */
export function pruneMagicLinks(usedRetainDays = 7): number {
	const cutoff = Math.floor(Date.now() / 1000) - usedRetainDays * 86400;
	const info = db
		.prepare(
			`DELETE FROM magic_links
			 WHERE expires_at < unixepoch()
			    OR (used_at IS NOT NULL AND used_at < ?)`
		)
		.run(cutoff);
	return info.changes;
}

/**
 * Drop session rows that haven't been seen in {idleDays}. Sessions are
 * "permanent" by spec (10 year cookie) but rows for dormant users add up.
 * Default: retain sessions seen in the last 365 days.
 */
export function pruneIdleSessions(idleDays = 365): number {
	const cutoff = Math.floor(Date.now() / 1000) - idleDays * 86400;
	const info = db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(cutoff);
	return info.changes;
}

/**
 * Delete upload files on disk that no `attachments.stored_name` references.
 * Safe even if the row was deleted seconds ago.
 *
 * The 'complete' and 'attached' upload_sessions rows also protect their
 * assembled file: `partial_path` is repurposed to hold the storedName after
 * completeUploadSession() runs. Excluding these from the orphan set prevents
 * the prune from deleting files that were assembled but not yet attached to a
 * message ('complete') or already linked ('attached').
 */
export function pruneOrphanUploads(): { removed: number; bytesFreed: number } {
	const dir = resolve(config.uploadDir);
	let removed = 0;
	let bytesFreed = 0;

	const known = new Set<string>();
	for (const r of db.prepare('SELECT stored_name FROM attachments').all() as Array<{
		stored_name: string;
	}>) {
		known.add(r.stored_name);
		// The AAC rendition of a voice message lives next to its original.
		known.add(renditionName(r.stored_name));
	}

	// Protect assembled-but-not-yet-attached files. After completeUploadSession()
	// the row's partial_path holds the storedName (no directory separator).
	// Include 'attached' rows too: the file may briefly be in both statuses
	// during the transaction window.
	const sessionProtected = db
		.prepare(
			`SELECT partial_path FROM upload_sessions
			 WHERE status IN ('complete', 'attached')`
		)
		.all() as Array<{ partial_path: string }>;
	for (const r of sessionProtected) {
		// Only add if it looks like a storedName, not an absolute path to a .part file.
		if (!r.partial_path.includes('/') && !r.partial_path.includes('\\')) {
			known.add(r.partial_path);
		}
	}

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return { removed: 0, bytesFreed: 0 };
	}

	for (const name of entries) {
		if (known.has(name)) continue;
		const fullPath = join(dir, name);
		try {
			const st = statSync(fullPath);
			if (!st.isFile()) continue;
			// Don't nuke files that were just created — give the writer time
			// to register the attachment row.
			if (Date.now() - st.mtimeMs < 60_000) continue;
			unlinkSync(fullPath);
			removed += 1;
			bytesFreed += st.size;
		} catch {
			// ignore — file may have been removed between readdir and stat
		}
	}

	return { removed, bytesFreed };
}

/**
 * Delete attachments (DB row + file on disk) that are older than `retainDays`.
 *
 * Only runs when `UPLOAD_RETAIN_DAYS` is set to a positive integer. Default
 * is null (keep forever) so existing deployments are unaffected unless the
 * operator explicitly enables pruning.
 *
 * Voice notes grow at ~1 MB/min. At heavy use (60 min/day) that is ~1.7 GB/month.
 * Set UPLOAD_RETAIN_DAYS=365 to hold roughly one year of history.
 *
 * Safety: the function never deletes files whose DB row still exists unless
 * the row is being deleted here first. The orphan-sweep in pruneOrphanUploads
 * will clean the file after the row is gone.
 */
export function pruneOldAttachments(retainDays?: number): number {
	// Sprint 33: default changed from null (keep forever) to 180 days.
	// Falls back to config.uploadRetainDays which reads the env var.
	const days = retainDays ?? (config as { uploadRetainDays?: number }).uploadRetainDays ?? Number(process.env.UPLOAD_RETAIN_DAYS || '');
	if (!Number.isFinite(days) || days <= 0) {
		return 0; // retention disabled — keep everything
	}
	const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

	// Fetch rows to delete so we can remove the files too.
	const rows = db
		.prepare(
			`SELECT id, stored_name FROM attachments WHERE created_at < ? LIMIT 500`
		)
		.all(cutoff) as Array<{ id: number; stored_name: string }>;

	if (rows.length === 0) return 0;

	const ids = rows.map((r) => r.id);
	const placeholders = ids.map(() => '?').join(',');
	db.prepare(`DELETE FROM attachments WHERE id IN (${placeholders})`).run(...ids);

	// Best-effort file removal — orphan sweep catches any stragglers.
	const dir = resolve(config.uploadDir);
	let removed = 0;
	for (const row of rows) {
		try {
			unlinkSync(join(dir, row.stored_name));
			removeRendition(row.stored_name);
			removed++;
		} catch {
			// File already gone or never written — ignore.
		}
	}

	log.info('pruneOldAttachments', { retainDays: days, rowsDeleted: ids.length, filesRemoved: removed });
	return ids.length;
}

/**
 * Auto-close tickets in 'pending' status that haven't seen activity in
 * {pendingDays}. We intentionally never auto-close 'open' tickets — that
 * status means "needs attention". Pending tickets are the admin's
 * "waiting on user" pile.
 */
export function autoClosePendingTickets(pendingDays = 14): number {
	const cutoff = Math.floor(Date.now() / 1000) - pendingDays * 86400;
	const info = db
		.prepare(
			`UPDATE tickets
			 SET status = 'closed', updated_at = unixepoch()
			 WHERE status = 'pending' AND updated_at < ?`
		)
		.run(cutoff);
	return info.changes;
}

export function runFullCleanup(): CleanupReport {
	const magicLinksRemoved = pruneMagicLinks();
	const sessionsExpired = pruneIdleSessions();
	// Prune expired tus upload sessions before the orphan sweep so the
	// partial files are gone before the directory scanner runs.
	const uploadSessionsPruned = pruneExpiredSessions();
	// Prune old attachments first so the orphan sweep below can reclaim those files.
	const oldAttachmentsRemoved = pruneOldAttachments();
	const { removed, bytesFreed } = pruneOrphanUploads();
	const ticketsAutoClosed = autoClosePendingTickets();
	const auditPruned = pruneAudit();
	return {
		magicLinksRemoved,
		sessionsExpired,
		orphanFilesRemoved: removed,
		orphanBytesFreed: bytesFreed,
		ticketsAutoClosed,
		auditPruned,
		oldAttachmentsRemoved,
		uploadSessionsPruned
	};
}

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupStarted = false;

/**
 * Run `runFullCleanup` once a day, in-process. Activated when
 * `HILO_CLEANUP_WORKER` is unset or `'1'`. Set to `'0'` to disable and
 * keep using the external cron in `scripts/cleanup.js`.
 */
export function startCleanupWorker(): void {
	if (cleanupStarted) return;
	if ((process.env.HILO_CLEANUP_WORKER ?? '1') !== '1') return;
	cleanupStarted = true;
	const intervalMs = Number(process.env.HILO_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000);
	const tick = () => {
		try {
			const report = runFullCleanup();
			log.info('cleanup ran', report as unknown as Record<string, unknown>);
		} catch (err) {
			log.warn('cleanup failed', { error: (err as Error).message });
		} finally {
			cleanupTimer = setTimeout(tick, intervalMs);
		}
	};
	// Delay the first sweep a minute after boot so we don't fight start-up I/O.
	cleanupTimer = setTimeout(tick, 60_000);
	log.info('cleanup worker started', { interval_ms: intervalMs });
}

export function stopCleanupWorker(): void {
	if (cleanupTimer) clearTimeout(cleanupTimer);
	cleanupTimer = null;
	cleanupStarted = false;
}
