import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listAuditEntries } from '$lib/server/audit';

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'admin') throw error(403, 'Forbidden');
	const action = url.searchParams.get('action') || undefined;
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
	const perPage = 50;
	const result = listAuditEntries({
		action,
		limit: perPage,
		offset: (page - 1) * perPage
	});
	return { ...result, page, perPage, filter: { action: action ?? '' } };
};
