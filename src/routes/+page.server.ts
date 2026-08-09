import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	// Signed-in users land straight in the app; anonymous visitors get the
	// public marketing landing page rendered by +page.svelte.
	if (locals.user) throw redirect(302, '/tickets');
	return {};
};
