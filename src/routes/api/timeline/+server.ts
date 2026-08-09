/**
 * GET /api/timeline
 *
 * Returns the parsed `TIMELINE_DEPLOY.md` as JSON so the navbar's
 * "What's new" bell can show the most recent deploys to logged-in
 * users. Parsing and caching live in `$lib/server/timeline.ts` and
 * are shared with the `/changelog` page server-side loader.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadTimeline } from '$lib/server/timeline';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	return json(loadTimeline());
};
