/**
 * Outbound-email queue. Lives in the same process as the SvelteKit server;
 * one worker drains `email_outbox` every {POLL_MS} milliseconds.
 *
 * Why a queue and not direct send? Two reasons:
 *   1. Schedule support — users can opt to only get emails during business
 *      hours in their region.
 *   2. SMTP outages — a transient Gmail/Postfix hiccup that survives the
 *      three in-flight retries still has another chance on the next poll.
 *
 * Single-process, single-instance. No locking. The schema marks rows by
 * `sent_at IS NULL`; a second worker on the same DB would double-send.
 */

import { db } from './db';
import { config } from './env';
import { log } from './logger';
import { isTestAccount } from './testAccounts';
import type { DBOutboxItem } from './db';
import { getMailer } from './mailer';

const POLL_MS = Number(process.env.HILO_MAIL_POLL_MS || 30_000);
const MAX_ATTEMPTS = Number(process.env.HILO_MAIL_MAX_ATTEMPTS || 8);
const MAX_BATCH = Number(process.env.HILO_MAIL_BATCH_SIZE || 25);

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let draining = false;

export type EnqueueArgs = {
	userId: number | null;
	to: string;
	subject: string;
	text: string;
	html: string;
	attachments?: Array<{ filename: string; path: string; cid?: string; contentType?: string }>;
	sendAfter: number; // unix epoch (seconds)
};

export function enqueueEmail(args: EnqueueArgs): number {
	const info = db
		.prepare(
			`INSERT INTO email_outbox (user_id, to_email, subject, text_body, html_body,
			                            attachments_json, send_after)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			args.userId,
			args.to,
			args.subject,
			args.text,
			args.html,
			JSON.stringify(args.attachments ?? []),
			args.sendAfter
		);
	return Number(info.lastInsertRowid);
}

/**
 * Drain up to MAX_BATCH due rows. Called on the polling tick AND immediately
 * after every enqueue, so an "immediate" message goes out without waiting
 * for the next interval.
 */
export async function drain(): Promise<{ sent: number; failed: number }> {
	if (draining) return { sent: 0, failed: 0 };
	draining = true;
	let sent = 0;
	let failed = 0;
	try {
		const rows = db
			.prepare(
				`SELECT * FROM email_outbox
				 WHERE sent_at IS NULL AND send_after <= unixepoch() AND attempts < ?
				 ORDER BY send_after ASC, id ASC
				 LIMIT ?`
			)
			.all(MAX_ATTEMPTS, MAX_BATCH) as DBOutboxItem[];

		for (const row of rows) {
			const result = await deliver(row);
			if (result === 'ok') sent += 1;
			else failed += 1;
		}
	} catch (err) {
		log.error('mail-queue drain failed', { error: (err as Error).message });
	} finally {
		draining = false;
	}
	return { sent, failed };
}

async function deliver(row: DBOutboxItem): Promise<'ok' | 'fail'> {
	// Mail for test accounts is never handed to the SMTP server.
	if (isTestAccount(row.to_email)) {
		db.prepare(
			`UPDATE email_outbox SET sent_at = unixepoch(), error = 'skipped: test account' WHERE id = ?`
		).run(row.id);
		log.info('mail skipped for test account', { outbox_id: row.id });
		return 'ok';
	}
	let attachments: Array<{ filename: string; path: string; cid?: string; contentType?: string }> = [];
	try {
		attachments = JSON.parse(row.attachments_json) as typeof attachments;
	} catch {
		attachments = [];
	}
	try {
		await getMailer().send({
			from: config.smtp.from,
			to: row.to_email,
			subject: row.subject,
			text: row.text_body,
			html: row.html_body,
			attachments
		});
		db.prepare('UPDATE email_outbox SET sent_at = unixepoch(), error = NULL WHERE id = ?').run(
			row.id
		);
		log.info('mail sent', {
			outbox_id: row.id,
			to: row.to_email,
			attempts: row.attempts + 1
		});
		return 'ok';
	} catch (err) {
		const msg = (err as Error).message?.slice(0, 500) ?? 'unknown';
		db.prepare('UPDATE email_outbox SET attempts = attempts + 1, error = ? WHERE id = ?').run(
			msg,
			row.id
		);
		log.warn('mail send failed', { outbox_id: row.id, attempts: row.attempts + 1, error: msg });
		return 'fail';
	}
}

/**
 * Start the polling worker. Idempotent — calling it twice has no effect.
 * The first request to the server triggers this via hooks.server.ts.
 */
export function startMailWorker(): void {
	if (started) return;
	started = true;
	const tick = async () => {
		try {
			await drain();
		} finally {
			timer = setTimeout(tick, POLL_MS);
		}
	};
	// Slight delay so the first drain doesn't fight the SvelteKit boot.
	timer = setTimeout(tick, 5_000);
	log.info('mail-queue worker started', { poll_ms: POLL_MS });
}

export function stopMailWorker(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	started = false;
}
