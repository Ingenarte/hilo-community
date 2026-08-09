import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { demoteAdmin, listAdmins, promoteUserToAdmin } from '$lib/server/tickets';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

export const GET: RequestHandler = ({ locals }) => {
	requireAdmin(locals);
	return json({ admins: listAdmins() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { email?: string };
	const email = (data.email || '').trim();
	try {
		const admin = promoteUserToAdmin(email);
		return json({ ok: true, admin });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { id?: number };
	const id = Number(data.id);
	if (!Number.isFinite(id)) return json({ error: 'id is required' }, { status: 400 });
	if (id === locals.user!.id)
		return json({ error: 'You cannot demote yourself' }, { status: 400 });
	const ok = demoteAdmin(id);
	if (!ok) return json({ error: 'Refused: would leave the instance without admins' }, { status: 400 });
	return json({ ok: true });
};
