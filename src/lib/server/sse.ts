/**
 * Tiny in-memory pub/sub for SSE message streams per ticket.
 * Designed for a single-process deployment (the spec's "simple" target).
 */

type Sub = (event: string, data: unknown) => void;

const subs = new Map<number, Set<Sub>>();
const userSubs = new Map<number, Set<Sub>>();

export function subscribe(ticketId: number, fn: Sub): () => void {
	let set = subs.get(ticketId);
	if (!set) {
		set = new Set();
		subs.set(ticketId, set);
	}
	set.add(fn);
	return () => {
		set?.delete(fn);
		if (set && set.size === 0) subs.delete(ticketId);
	};
}

export function broadcast(ticketId: number, event: string, data: unknown): void {
	const set = subs.get(ticketId);
	if (!set) return;
	for (const fn of set) {
		try {
			fn(event, data);
		} catch {
			// ignore — broken subscriber will be cleaned up next message
		}
	}
}

/**
 * Per-user channel for app-wide activity events (badge, sound, toast).
 * A user can have several tabs open; each is its own subscriber.
 */
export function subscribeUser(userId: number, fn: Sub): () => void {
	let set = userSubs.get(userId);
	if (!set) {
		set = new Set();
		userSubs.set(userId, set);
	}
	set.add(fn);
	return () => {
		set?.delete(fn);
		if (set && set.size === 0) userSubs.delete(userId);
	};
}

export function broadcastToUser(userId: number, event: string, data: unknown): void {
	const set = userSubs.get(userId);
	if (!set) return;
	for (const fn of set) {
		try {
			fn(event, data);
		} catch {
			// ignore
		}
	}
}
