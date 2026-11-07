/**
 * Notification fan-out: a single place that decides who hears about a
 * new ticket or a new message and how (email, web push, in-app SSE).
 *
 * Why this exists: the same ~50-line block lived inline in
 * `routes/tickets/new/+page.server.ts` and `routes/api/messages/[id]/+server.ts`.
 * Two copies will always drift - the audit caught one already
 * (disabled-admin exclusion was inconsistent). Pulling it here means
 * future participants, dedup rules, or push payload changes happen once.
 *
 * What is NOT here: webhook dispatch. The webhook event name differs
 * per call site (`ticket.new` vs `ticket.reply`) and the payload is
 * caller-specific, so each route still dispatches its own webhooks.
 */

import { db } from './db';
import { getTicketParticipants } from './tickets';
import { sendMessageNotification, sendMovementNotification } from './email';
import { channelsForUser } from './deliveryPolicy';
import { sendWebPushToUser } from './webpush';
import { broadcastToUser } from './sse';
import { config } from './env';
import { log } from './logger';
import { isTestAccount } from './testAccounts';

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
	/** Plain-text body - used for email preview + push body. */
	body: string;
	attachments: SavedAttachment[];
	/** SSE event kind sent to open in-app tabs. */
	sseKind: 'ticket.new' | 'message';
	/** Fallback body text when `body` is empty (attachment-only messages). */
	fallbackPreview: string;
};

/**
 * Notify every ticket participant - and every active admin - except
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
	// Messages written by test accounts (reserved test domain) notify nobody.
	if (isTestAccount(args.authorEmail)) {
		log.info('notifications skipped for test account', { ticketId: args.ticketId });
		return;
	}
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

	const channelsByUser = new Map(userRecipients.map((p) => [p.user_id as number, channelsForUser(p.user_id as number)]));
	const emailRecipients = userRecipients.filter((p) => channelsByUser.get(p.user_id as number)!.email);

	// One email per person who needs it. People without a Hilo account (plain
	// followers) get a single copy attached to the first of those sends, or on
	// their own when everyone else is covered by push.
	let followersPending = emailOnly.slice();
	const send = (to: string | null, userId: number) => {
		const extras = followersPending;
		followersPending = [];
		sendMessageNotification({
			to,
			recipientUserId: userId,
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
				to,
				err: err instanceof Error ? err.message : String(err)
			})
		);
	};
	for (const p of emailRecipients) send(p.email, p.user_id as number);
	if (followersPending.length > 0 && userRecipients.length > 0) {
		send(null, userRecipients[0].user_id as number);
	}

	const preview = args.body.slice(0, 140) || args.fallbackPreview;
	const url = `${config.publicBaseUrl.replace(/\/$/, '')}/tickets/${args.ticketId}`;
	for (const p of userRecipients) {
		if (p.user_id === null) continue;
		if (channelsByUser.get(p.user_id)!.push) {
			sendWebPushToUser(p.user_id, {
				title: `${args.authorEmail} · ${args.ticketTitle}`,
				body: preview,
				url,
				tag: `hilo-${args.ticketId}`
			});
		}
		broadcastToUser(p.user_id, 'activity', {
			ticketId: args.ticketId,
			kind: args.sseKind,
			title: args.ticketTitle,
			sender: args.authorEmail,
			preview
		});
	}
}

export type TicketMovement = {
	ticketId: number;
	actor: { id: number; email: string; role: 'user' | 'admin' };
	/** Short, human summary, e.g. "Status changed to closed". */
	summary: string;
};

/**
 * Tell the people on a ticket that it moved (status, priority, assignment,
 * deadline, project). Same audience and channel rules as a new message; the
 * person who made the change is never notified.
 */
export function notifyTicketMovement(m: TicketMovement): void {
	try {
		if (isTestAccount(m.actor.email)) return;
		const ticket = db.prepare('SELECT id, title FROM tickets WHERE id = ?').get(m.ticketId) as
			| { id: number; title: string }
			| undefined;
		if (!ticket) return;
		const participants = getTicketParticipants(m.ticketId);
		const seen = new Set(participants.map((p) => p.email.toLowerCase()));
		const admins = db
			.prepare("SELECT id, email FROM users WHERE role = 'admin' AND disabled_at IS NULL")
			.all() as Array<{ id: number; email: string }>;
		for (const a of admins) {
			if (!seen.has(a.email.toLowerCase())) {
				participants.push({ email: a.email, user_id: a.id, role: 'admin' });
				seen.add(a.email.toLowerCase());
			}
		}
		const url = `${config.publicBaseUrl.replace(/\/$/, '')}/tickets/${m.ticketId}`;
		for (const p of participants) {
			if (p.user_id === null || p.user_id === m.actor.id) continue;
			if (isTestAccount(p.email)) continue;
			const ch = channelsForUser(p.user_id);
			if (ch.push) {
				sendWebPushToUser(p.user_id, {
					title: `#${ticket.id} · ${ticket.title}`,
					body: m.summary,
					url,
					tag: `hilo-move-${ticket.id}`
				});
			}
			if (ch.email) {
				sendMovementNotification({
					to: p.email,
					recipientUserId: p.user_id,
					ticketId: ticket.id,
					ticketTitle: ticket.title,
					actorEmail: m.actor.email,
					summary: m.summary
				}).catch((err) =>
					log.error('movement email failed', { ticketId: ticket.id, err: err instanceof Error ? err.message : String(err) })
				);
			}
			broadcastToUser(p.user_id, 'activity', {
				ticketId: ticket.id,
				kind: 'edit',
				title: ticket.title,
				sender: m.actor.email,
				preview: m.summary
			});
		}
	} catch (err) {
		log.error('notifyTicketMovement failed', { ticketId: m.ticketId, err: err instanceof Error ? err.message : String(err) });
	}
}
