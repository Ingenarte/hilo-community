import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/**
 * Mark the current user as having seen the first-login install-help modal.
 * Idempotent: if already set, the UPDATE is a no-op (WHERE clause filters it).
 * Returns 204 No Content on success.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	// Only stamp the timestamp the first time. Subsequent calls are no-ops.
	db.prepare(
		`UPDATE users
		 SET seen_install_help_at = strftime('%s','now')
		 WHERE id = ? AND seen_install_help_at IS NULL`
	).run(locals.user.id);

	return new Response(null, { status: 204 });
};
