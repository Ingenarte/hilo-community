import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { statfsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '$lib/server/env';

/**
 * Granular liveness + readiness probe.
 *
 * Returns 200 if every critical subsystem is healthy, 503 with a detailed
 * `checks` map otherwise. All checks are local: one tiny SQLite query,
 * one `statfs` on the upload volume, a count over the in-memory queue.
 * No outbound network — never blocks waiting on SMTP.
 */
export const GET: RequestHandler = () => {
	const checks: Record<string, { ok: boolean; [k: string]: unknown }> = {};
	let allOk = true;

	// ─── SQLite ──────────────────────────────────────────────────────────
	const t0 = Date.now();
	try {
		const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
		const latencyMs = Date.now() - t0;
		checks.sqlite = { ok: row?.ok === 1, latency_ms: latencyMs };
		if (!checks.sqlite.ok) allOk = false;
	} catch (err) {
		checks.sqlite = { ok: false, error: (err as Error).message };
		allOk = false;
	}

	// ─── Free disk space on the upload volume ────────────────────────────
	try {
		const stat = statfsSync(resolve(config.uploadDir));
		const free = Number(stat.bavail) * Number(stat.bsize);
		const total = Number(stat.blocks) * Number(stat.bsize);
		const usedPct = total > 0 ? +(((total - free) / total) * 100).toFixed(1) : 0;
		// Refuse readiness below 100 MB free OR over 95% used.
		const ok = free > 100 * 1024 * 1024 && usedPct < 95;
		checks.disk = { ok, free_bytes: free, used_pct: usedPct };
		if (!ok) allOk = false;
	} catch (err) {
		// statfs is best-effort. Some sandboxes block it; treat as non-fatal.
		checks.disk = { ok: true, skipped: true, error: (err as Error).message };
	}

	// ─── Outbox sanity ───────────────────────────────────────────────────
	try {
		const pending = (
			db
				.prepare(
					'SELECT COUNT(*) AS n FROM email_outbox WHERE sent_at IS NULL AND send_after <= unixepoch() AND attempts = 0'
				)
				.get() as { n: number }
		).n;
		const failing = (
			db
				.prepare(
					'SELECT COUNT(*) AS n FROM email_outbox WHERE sent_at IS NULL AND attempts >= 5'
				)
				.get() as { n: number }
		).n;
		// Backlog over 200 is a soft alarm but doesn't fail readiness.
		checks.outbox = { ok: true, pending, failing, backlog_warning: pending > 200 };
	} catch (err) {
		checks.outbox = { ok: false, error: (err as Error).message };
		allOk = false;
	}

	const body = {
		status: allOk ? 'ok' : 'degraded',
		uptime_seconds: Math.floor(process.uptime()),
		pid: process.pid,
		checks
	};
	return json(body, { status: allOk ? 200 : 503 });
};
