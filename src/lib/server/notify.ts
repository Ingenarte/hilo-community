/**
 * Notification fan-out: a single place that decides who hears about a
 * new ticket or a new message and how (email, web push, in-app SSE).
 *
 * Why this exists: the same ~50-line block lived inline in
 * `routes/tickets/new/+page.server.ts` and `routes/api/messages/[id]/+server.ts`.
 * Two copies will always drift — the audit caught one already
 * (disabled-admin exclusion was inconsistent). Pulling it here means
 * future participants, dedup rules, or push payload changes happen once.
 *
 * What is NOT here: webhook dispatch. The webhook event name differs
 * per call site (`ticket.new` vs `ticket.reply`) and the payload is
 * caller-specific, so each route still dispatches its own webhooks.
 */

import { db } from './db';
import { getTicketParticipants } from './tickets';
import { sendMessageNotification } from './email';
import { sendWebPushToUser } from './webpush';
import { broadcastToUser } from './sse';
import { config } from './env';
import { log } from './logger';

type SavedAttachment = {
	id: number;
	filename: string;
	stored_name: string;
	mime_type: string;
	size_bytes: number;
};

export type FanOutArgs = {
	ticketId: number;
	ticketTitle: string;
	/** Lowercased email is used for dedup against participant list. */
	authorEmail: string;
	authorRole: 'user' | 'admin';
	/** Plain-text body — used for email preview + push body. */
	body: string;
	attachments: SavedAttachment[];
	/** SSE event kind sent to open in-app tabs. */
	sseKind: 'ticket.new' | 'message';
	/** Fallback body text when `body` is empty (attachment-only messages). */
	fallbackPreview: string;
};

/**
 * Notify every ticket participant — and every active admin — except
 * the author.
 *
 * - Active admins are always added even if they are not stored as
 *   followers, so the inbox stays alive when an external user replies.
 * - Disabled admins are excluded.
 * - Plain follower emails (no Hilo user) are CC'd on the email send.
 * - Each Hilo user gets a web-push notification and an SSE activity
 *   ping for any open tab.
 *
 * Email sending is fire-and-forget: a slow SMTP server must not delay
 * the HTTP response the user is waiting for.
 */
export async function fanOutMessageNotification(args: FanOutArgs): Promise<void> {
	const authorEmailLower = args.authorEmail.toLowerCase();
	const participants = getTicketParticipants(args.ticketId);
	const seen = new Set(participants.map((p) => p.email.toLowerCase()));

	const admins = db
		.prepare("SELECT id, email FROM users WHERE role = 'admin' AND disabled_at IS NULL")
		.all() as Array<{ id: number; email: string }>;
	for (const a of admins) {
		const key = a.email.toLowerCase();
		if (!seen.has(key)) {
			participants.push({ email: a.email, user_id: a.id, role: 'admin' });
			seen.add(key);
		}
	}

	const userRecipients = participants.filter(
		(p) => p.user_id !== null && p.email.toLowerCase() !== authorEmailLower
	);
	const emailOnly = participants
		.filter((p) => p.user_id === null && p.email.toLowerCase() !== authorEmailLower)
		.map((p) => p.email);

	if (userRecipients.length === 0 && emailOnly.length === 0) return;

	if (userRecipients.length > 0) {
		const primary = userRecipients[0];
		const extras = userRecipients
			.slice(1)
			.map((p) => p.email)
			.concat(emailOnly);
		sendMessageNotification({
			to: primary.email,
			recipientUserId: primary.user_id as number,
			ticketId: args.ticketId,
			ticketTitle: args.ticketTitle,
			authorEmail: args.authorEmail,
			authorRole: args.authorRole,
			preview: args.body,
			attachments: args.attachments,
			extraRecipients: extras
		}).catch((err) =>
			log.error('notify email send failed', {
				ticketId: args.ticketId,
				to: primary.email,
				err: err instanceof Error ? err.message : String(err)
			})
		);
	}

	const preview = args.body.slice(0, 140) || args.fallbackPreview;
	const url = `${config.publicBaseUrl.replace(/\/$/, '')}/tickets/${args.ticketId}`;
	for (const p of userRecipients) {
		if (p.user_id === null) continue;
		sendWebPushToUser(p.user_id, {
			title: `${args.authorEmail} · ${args.ticketTitle}`,
			body: preview,
			url,
			tag: `hilo-${args.ticketId}`
		});
		broadcastToUser(p.user_id, 'activity', {
			ticketId: args.ticketId,
			kind: args.sseKind,
			title: args.ticketTitle,
			sender: args.authorEmail,
			preview
		});
	}
}
