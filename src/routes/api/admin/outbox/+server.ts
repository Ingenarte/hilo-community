import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { drain } from '$lib/server/mailQueue';
import { audit } from '$lib/server/audit';

/**
 * GET  → list outbox rows (most recent first), filterable.
 * POST { id, op: 'retry' | 'cancel' }
 *   - retry: clears attempts/error so the worker picks the row again
 *   - cancel: marks `sent_at` so the worker skips it
 */
function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

export const GET: RequestHandler = ({ locals, url }) => {
	requireAdmin(locals);
	const status = url.searchParams.get('status') || 'all'; // 'pending' | 'sent' | 'failed' | 'all'
	const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 500);
	const where: string[] = [];
	if (status === 'pending') where.push('sent_at IS NULL AND attempts = 0');
	else if (status === 'sent') where.push('sent_at IS NOT NULL');
	else if (status === 'failed') where.push('sent_at IS NULL AND attempts > 0');
	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const rows = db
		.prepare(
			`SELECT id, user_id, to_email, subject, send_after, attempts, sent_at, error,
			        created_at, length(html_body) AS html_size
			 FROM email_outbox ${clause}
			 ORDER BY id DESC LIMIT ?`
		)
		.all(limit);
	return json({ rows });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { id?: number; op?: string };
	const id = Number(data.id);
	if (!Number.isFinite(id) || id <= 0)
		return json({ error: 'id is required' }, { status: 400 });
	if (data.op === 'retry') {
		db.prepare(
			'UPDATE email_outbox SET attempts = 0, error = NULL, send_after = unixepoch() WHERE id = ?'
		).run(id);
		audit('outbox.retry', { actor: locals.user, target: `outbox:${id}` });
		void drain();
		return json({ ok: true });
	}
	if (data.op === 'cancel') {
		db.prepare(
			"UPDATE email_outbox SET sent_at = unixepoch(), error = COALESCE(error,'') || ' (cancelled by admin)' WHERE id = ?"
		).run(id);
		audit('outbox.cancel', { actor: locals.user, target: `outbox:${id}` });
		return json({ ok: true });
	}
	return json({ error: 'op must be retry or cancel' }, { status: 400 });
};
