import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessTicket, getTicket } from '$lib/server/tickets';
import { subscribe } from '$lib/server/sse';

export const GET: RequestHandler = ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');
	const t = getTicket(id);
	if (!t) throw error(404, 'Not found');
	if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');

	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const write = (event: string, data: unknown) => {
				try {
					controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					// closed
				}
			};

			write('hello', { ticketId: id });

			const unsub = subscribe(id, (event, data) => write(event, data));
			const ping = setInterval(() => write('ping', { t: Date.now() }), 25_000);

			// closed-detection — we cannot listen on the controller directly; rely on caller abort
			(controller as unknown as { _cleanup?: () => void })._cleanup = () => {
				clearInterval(ping);
				unsub();
			};
		},
		cancel() {
			// noop, cleanup happens via _cleanup if attached
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
