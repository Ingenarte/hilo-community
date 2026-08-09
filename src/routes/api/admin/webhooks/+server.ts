import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createWebhook,
	deleteWebhook,
	listWebhooks,
	setWebhookEnabled
} from '$lib/server/tickets';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

const KINDS = new Set(['slack', 'discord', 'generic']);
const ALLOWED_EVENTS = new Set([
	'ticket.new',
	'ticket.reply',
	'ticket.urgent',
	'ticket.closed',
	'ticket.assigned'
]);

export const GET: RequestHandler = ({ locals }) => {
	requireAdmin(locals);
	return json({ webhooks: listWebhooks() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as {
		name?: string;
		url?: string;
		kind?: string;
		events?: string;
	};
	const name = (data.name || '').trim();
	const url = (data.url || '').trim();
	const kind = (data.kind || 'generic').toLowerCase();
	const events = (data.events || 'ticket.new')
		.split(',')
		.map((e) => e.trim())
		.filter((e) => ALLOWED_EVENTS.has(e))
		.join(',');

	if (!name || !url || !KINDS.has(kind) || !events)
		return json({ error: 'name, url, kind, events are required' }, { status: 400 });
	if (!/^https?:\/\//i.test(url))
		return json({ error: 'url must be http(s)://' }, { status: 400 });

	const id = createWebhook({ name, url, kind: kind as 'slack' | 'discord' | 'generic', events });
	return json({ ok: true, id });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { id?: number };
	const id = Number(data.id);
	if (!Number.isFinite(id) || id <= 0)
		return json({ error: 'id is required' }, { status: 400 });
	deleteWebhook(id);
	return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { id?: number; enabled?: boolean };
	const id = Number(data.id);
	if (!Number.isFinite(id) || id <= 0)
		return json({ error: 'id is required' }, { status: 400 });
	setWebhookEnabled(id, !!data.enabled);
	return json({ ok: true });
};
