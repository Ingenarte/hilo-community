import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadOpenTicketsView } from '$lib/server/openTicketsView';

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');
	return loadOpenTicketsView(locals.user, url);
};
