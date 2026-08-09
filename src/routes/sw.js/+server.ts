import type { RequestHandler } from './$types';
import body from './sw-content.js?raw';

/**
 * Service Worker endpoint.
 *
 * Why this is a SvelteKit route and not a plain file in `static/`:
 *
 *   - Service Workers MUST be served fresh on every register call. If a
 *     CDN (Cloudflare, in our case) caches sw.js, an updated worker can
 *     stay invisible to clients for hours — the browser's special SW
 *     "byte-by-byte" check still uses HTTP caching headers when fetching
 *     the file from the edge.
 *   - static/sw.js would inherit the CDN's default 4-hour TTL.
 *   - hooks.server.ts can't help: static files are served before hooks
 *     by adapter-node.
 *
 * So we serve the worker body from a +server.ts route and explicitly set
 * `Cache-Control: no-store, must-revalidate`. Every deploy reaches users
 * without any dashboard work or manual cache purges.
 */
export const GET: RequestHandler = () => {
	return new Response(body, {
		headers: {
			'content-type': 'application/javascript; charset=utf-8',
			'cache-control': 'no-store, max-age=0, must-revalidate',
			// Explicit max scope so the worker can control the whole origin
			// even though Hilo serves it directly from `/sw.js`. Default
			// scope is already `/` for a root-served worker — this header
			// just makes the contract explicit for any future move.
			'service-worker-allowed': '/'
		}
	});
};

// Defensive: in case SvelteKit ever decides to prerender GET endpoints,
// flag this one as dynamic. The headers above only make sense on a live
// response per request.
export const prerender = false;
