// Remembers the order of the list a ticket was opened from (inbox with its
// filters, Queue or Gantt) so the ticket page can offer previous / next.
// Client-only (sessionStorage): the snapshot dies with the tab.

export type TicketNavSource = 'inbox' | 'queue' | 'gantt';

export type TicketNav = {
	/** Path + query of the list, used by the back button. */
	href: string;
	source: TicketNavSource;
	ids: number[];
	/** Unix ms when the snapshot was taken. */
	at: number;
};

const KEY = 'hilo.ticketNav';
const MAX_AGE_MS = 6 * 3600 * 1000;

export function saveTicketNav(nav: Omit<TicketNav, 'at'>): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify({ ...nav, at: Date.now() } satisfies TicketNav));
	} catch {
		// Storage can be blocked (private mode); navigation just stays off.
	}
}

export function loadTicketNav(): TicketNav | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return null;
		const nav = JSON.parse(raw) as TicketNav;
		if (!Array.isArray(nav.ids) || typeof nav.href !== 'string') return null;
		if (Date.now() - nav.at > MAX_AGE_MS) return null;
		return nav;
	} catch {
		return null;
	}
}

export type TicketPosition = {
	prev: number | null;
	next: number | null;
	/** 1-based position in the list. */
	index: number;
	total: number;
};

/** Where `ticketId` sits in the stored list, or null when it is not in it. */
export function positionIn(nav: TicketNav | null, ticketId: number): TicketPosition | null {
	if (!nav) return null;
	const i = nav.ids.indexOf(ticketId);
	if (i < 0) return null;
	return {
		prev: i > 0 ? nav.ids[i - 1] : null,
		next: i < nav.ids.length - 1 ? nav.ids[i + 1] : null,
		index: i + 1,
		total: nav.ids.length
	};
}
