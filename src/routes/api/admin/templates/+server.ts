import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createTemplate, deleteTemplate, listTemplates } from '$lib/server/tickets';

function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');
}

export const GET: RequestHandler = ({ locals }) => {
	requireAdmin(locals);
	return json({ templates: listTemplates() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { title?: string; body?: string };
	const title = (data.title || '').trim();
	const body = (data.body || '').trim();
	if (!title || !body)
		return json({ error: 'title and body are required' }, { status: 400 });
	const id = createTemplate({ title, body, createdBy: locals.user!.id });
	return json({ ok: true, id });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const data = (await request.json().catch(() => ({}))) as { id?: number };
	const id = Number(data.id);
	if (!Number.isFinite(id) || id <= 0)
		return json({ error: 'id is required' }, { status: 400 });
	deleteTemplate(id);
	return json({ ok: true });
};
