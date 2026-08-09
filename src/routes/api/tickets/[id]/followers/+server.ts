import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	addFollower,
	canAccessTicket,
	getTicket,
	listFollowers,
	removeFollower
} from '$lib/server/tickets';

function authorise(ticketId: number, locals: App.Locals) {
	if (!locals.user) throw error(401, 'Unauthorized');
	const t = getTicket(ticketId);
	if (!t) throw error(404, 'Ticket not found');
	if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');
	return t;
}

export const GET: RequestHandler = ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');
	authorise(id, locals);
	return json({ followers: listFollowers(id) });
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');
	authorise(id, locals);
	const data = (await request.json().catch(() => ({}))) as { email?: string };
	const email = (data.email ?? '').trim();
	if (!addFollower({ ticketId: id, email, addedBy: locals.user!.id }))
		return json({ error: 'Invalid email' }, { status: 400 });
	return json({ ok: true, followers: listFollowers(id) });
};

export const DELETE: RequestHandler = async ({ params, locals, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');
	authorise(id, locals);
	const data = (await request.json().catch(() => ({}))) as { email?: string };
	const email = (data.email ?? '').trim();
	if (!email) return json({ error: 'Email required' }, { status: 400 });
	removeFollower(id, email);
	return json({ ok: true, followers: listFollowers(id) });
};
