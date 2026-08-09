/**
 * Append-only audit log. Used by /admin/audit and the cleanup script's
 * retention sweep.
 *
 * Every helper that wants to record an "interesting" event calls
 * `audit('thing.happened', { actor, target, detail })`. The persisting is
 * synchronous (better-sqlite3 is sync) but cheap — a single INSERT.
 */

import { db } from './db';
import { log } from './logger';

export type AuditActor = { id: number; email: string } | null;

export type AuditEntry = {
	id: number;
	actor_id: number | null;
	actor_email: string | null;
	action: string;
	target: string | null;
	detail_json: string | null;
	created_at: number;
};

export function audit(
	action: string,
	args: { actor?: AuditActor; target?: string | null; detail?: Record<string, unknown> } = {}
): void {
	try {
		db.prepare(
			`INSERT INTO audit_log (actor_id, actor_email, action, target, detail_json)
			 VALUES (?, ?, ?, ?, ?)`
		).run(
			args.actor?.id ?? null,
			args.actor?.email ?? null,
			action,
			args.target ?? null,
			args.detail ? JSON.stringify(args.detail) : null
		);
	} catch (err) {
		// Persisting the audit log mustn't break the request that triggered
		// it. Log it as a warning and move on.
		log.warn('audit log insert failed', {
			action,
			error: (err as Error).message
		});
	}
}

export type AuditQuery = {
	action?: string;
	actorId?: number;
	since?: number; // unix epoch seconds
	limit?: number;
	offset?: number;
};

export function listAuditEntries(q: AuditQuery = {}): { entries: AuditEntry[]; total: number } {
	const where: string[] = [];
	const params: Record<string, unknown> = {};
	if (q.action) {
		where.push('action = $action');
		params.action = q.action;
	}
	if (q.actorId !== undefined) {
		where.push('actor_id = $actorId');
		params.actorId = q.actorId;
	}
	if (q.since !== undefined) {
		where.push('created_at >= $since');
		params.since = q.since;
	}
	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${clause}`).get(params) as {
		n: number;
	}).n;
	const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
	const offset = Math.max(q.offset ?? 0, 0);
	const entries = db
		.prepare(
			`SELECT * FROM audit_log ${clause}
			 ORDER BY created_at DESC, id DESC LIMIT $limit OFFSET $offset`
		)
		.all({ ...params, limit, offset }) as AuditEntry[];
	return { entries, total };
}

/**
 * Retention sweep — drops audit rows older than {days}. Default = 365 days.
 * Called from `scripts/cleanup.js` and the in-process cleanup worker.
 */
export function pruneAudit(days = 365): number {
	const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
	const info = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff);
	return info.changes;
}
