import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { subscribeUser } from '$lib/server/sse';

/**
 * Per-user activity stream. Sends `activity` events whenever the user is
 * a participant on a ticket that received a new message. The client uses
 * this to bump the in-app badge / play a sound / set the OS app badge.
 *
 * Heartbeat comment every 25s keeps proxies (Cloudflare buffers idle
 * SSE connections at ~100s) from dropping the socket.
 */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const userId = locals.user.id;

	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const send = (event: string, data: unknown) => {
				try {
					controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					// stream closed
				}
			};
			send('hello', { userId });
			const unsubscribe = subscribeUser(userId, send);
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(enc.encode(`: heartbeat\n\n`));
				} catch {
					clearInterval(heartbeat);
				}
			}, 25000);
			// `cancel` runs when the client disconnects.
			return () => {
				clearInterval(heartbeat);
				unsubscribe();
			};
		},
		cancel() {
			// runtime calls this on disconnect — start()'s teardown closes too
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			// Disable the SvelteKit/adapter-node body buffering proxies do.
			'x-accel-buffering': 'no'
		}
	});
};
