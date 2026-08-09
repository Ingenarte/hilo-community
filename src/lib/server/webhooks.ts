/**
 * Outbound webhook dispatcher. Sends a Slack-, Discord-, or raw-JSON-shaped
 * payload to every enabled webhook subscribed to the given event.
 *
 * Fire-and-forget: failures are logged but never block the caller. Retries
 * are handled by the generic `withRetry` helper.
 */

import { listWebhooks } from './tickets';
import { withRetry } from './retry';
import { log } from './logger';
import { config } from './env';

export type WebhookEvent =
	| 'ticket.new'
	| 'ticket.reply'
	| 'ticket.urgent'
	| 'ticket.closed'
	| 'ticket.assigned';

export type WebhookPayload = {
	event: WebhookEvent;
	ticket_id: number;
	title: string;
	priority: string;
	status: string;
	author?: string;
	preview?: string;
	url: string;
	brand: string;
};

function slackBody(p: WebhookPayload) {
	return {
		text: `*${p.brand}* · ${eventLabel(p.event)}: #${p.ticket_id} ${p.title}`,
		attachments: [
			{
				color: p.event === 'ticket.urgent' ? '#dc2626' : '#7c3aed',
				fields: [
					{ title: 'Author', value: p.author ?? '—', short: true },
					{ title: 'Priority', value: p.priority, short: true },
					{ title: 'Status', value: p.status, short: true },
					{ title: 'Link', value: `<${p.url}|Open conversation>`, short: false }
				],
				footer: p.preview?.slice(0, 200) ?? ''
			}
		]
	};
}

function discordBody(p: WebhookPayload) {
	const color = p.event === 'ticket.urgent' ? 0xdc2626 : 0x7c3aed;
	return {
		username: p.brand,
		embeds: [
			{
				title: `#${p.ticket_id} · ${p.title}`,
				description: p.preview?.slice(0, 1500) ?? '',
				url: p.url,
				color,
				fields: [
					{ name: 'Event', value: eventLabel(p.event), inline: true },
					{ name: 'Author', value: p.author ?? '—', inline: true },
					{ name: 'Priority', value: p.priority, inline: true },
					{ name: 'Status', value: p.status, inline: true }
				]
			}
		]
	};
}

function eventLabel(e: WebhookEvent): string {
	switch (e) {
		case 'ticket.new':
			return 'New ticket';
		case 'ticket.reply':
			return 'New reply';
		case 'ticket.urgent':
			return 'Urgent ticket';
		case 'ticket.closed':
			return 'Ticket closed';
		case 'ticket.assigned':
			return 'Ticket assigned';
	}
}

export function dispatchWebhooks(event: WebhookEvent, payload: Omit<WebhookPayload, 'event'>) {
	const full: WebhookPayload = { event, ...payload };
	const hooks = listWebhooks().filter(
		(h) => h.enabled === 1 && h.events.split(',').map((e) => e.trim()).includes(event)
	);
	if (hooks.length === 0) return;

	for (const hook of hooks) {
		const body = hook.kind === 'slack' ? slackBody(full) : hook.kind === 'discord' ? discordBody(full) : full;
		withRetry(
			async () => {
				const res = await fetch(hook.url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'User-Agent': `${config.brand}-webhook/1.0`
					},
					body: JSON.stringify(body)
				});
				if (!res.ok) throw new Error(`webhook ${hook.id} returned ${res.status}`);
			},
			{ attempts: 3, baseDelayMs: 2_000 }
		).catch((err) =>
			log.warn('webhook dispatch failed', {
				webhook_id: hook.id,
				event,
				error: (err as Error).message
			})
		);
	}
}
