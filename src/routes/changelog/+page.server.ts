import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadTimeline } from '$lib/server/timeline';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	return loadTimeline();
};
