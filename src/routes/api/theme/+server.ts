import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setUserTheme } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	let theme: string | undefined;
	const ctype = request.headers.get('content-type') || '';
	if (ctype.includes('application/json')) {
		const data = (await request.json().catch(() => ({}))) as { theme?: string };
		theme = data.theme;
	} else {
		const form = await request.formData();
		theme = String(form.get('theme') || '');
	}

	if (theme !== 'dark' && theme !== 'light') {
		throw error(400, 'theme must be "dark" or "light"');
	}

	setUserTheme(locals.user.id, theme);
	locals.user.theme = theme;
	return json({ ok: true, theme });
};
