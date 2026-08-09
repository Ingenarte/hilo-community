import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ACCENTS, setUserAccent, type Accent } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	let accent: string | undefined;
	const ctype = request.headers.get('content-type') || '';
	if (ctype.includes('application/json')) {
		const data = (await request.json().catch(() => ({}))) as { accent?: string };
		accent = data.accent;
	} else {
		const form = await request.formData();
		accent = String(form.get('accent') || '');
	}

	if (!ACCENTS.includes(accent as Accent)) {
		throw error(400, `accent must be one of ${ACCENTS.join(', ')}`);
	}
	setUserAccent(locals.user.id, accent as Accent);
	locals.user.accent = accent as Accent;
	return json({ ok: true, accent });
};
