import { error } from '@sveltejs/kit';

/**
 * State-changing JSON endpoints: require a JSON content type (which forces a
 * CORS preflight, so a cross-site "simple" request cannot reach the handler)
 * and, when the browser sent an Origin, that it matches this site.
 */
export function assertSameOriginJson(request: Request, url: URL): void {
	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().startsWith('application/json')) {
		throw error(415, 'Content-Type must be application/json');
	}
	assertSameOrigin(request, url);
}

/** For body-less state changes (e.g. DELETE): a present Origin must match this site. */
export function assertSameOrigin(request: Request, url: URL): void {
	const origin = request.headers.get('origin');
	if (origin !== null && origin !== url.origin) throw error(403, 'Cross-origin request blocked');
}
