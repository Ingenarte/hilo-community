import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import { extendTicketTime, listTicketExtensions } from '../src/lib/server/tickets';
import { appendMessage } from '../src/lib/server/tickets-messages';
import { checkExtendRequest, EXTEND_REASON_MAX } from '../src/lib/sla';

const now = () => Math.floor(Date.now() / 1000);
const HOUR = 3600;

function ticket(due: number | null, status = 'open') {
	db.prepare(`DELETE FROM users WHERE email = 'ext-owner@hilo.test'`).run();
	const owner = Number(db.prepare(`INSERT INTO users (email, role) VALUES ('ext-owner@hilo.test','user')`).run().lastInsertRowid);
	const id = Number(
		db.prepare(`INSERT INTO tickets (user_id, title, priority, status, sla_due_at) VALUES (?, 'ext test', 'normal', ?, ?)`).run(owner, status, due).lastInsertRowid
	);
	return { owner, id };
}
const dueOf = (id: number) => (db.prepare('SELECT sla_due_at AS d FROM tickets WHERE id = ?').get(id) as { d: number }).d;

describe('checkExtendRequest', () => {
	it('needs a valid amount and a written reason', () => {
		expect(checkExtendRequest(24, 'Waiting for the client credentials')).toEqual({ ok: true, hours: 24, reason: 'Waiting for the client credentials' });
		expect(checkExtendRequest('48', '  trimmed reason here  ')).toMatchObject({ ok: true, hours: 48, reason: 'trimmed reason here' });
		expect(checkExtendRequest(5, 'long enough reason').ok).toBe(false);
		expect(checkExtendRequest(24, 'short').ok).toBe(false);
		expect(checkExtendRequest(24, '          ').ok).toBe(false);
		expect(checkExtendRequest(24, undefined).ok).toBe(false);
		expect(checkExtendRequest(24, 'x'.repeat(EXTEND_REASON_MAX + 1)).ok).toBe(false);
		expect(checkExtendRequest(24, 'x'.repeat(EXTEND_REASON_MAX)).ok).toBe(true);
		expect(checkExtendRequest(NaN, 'long enough reason').ok).toBe(false);
	});
});

describe('extendTicketTime', () => {
	it('adds the hours to a running target and records the request', () => {
		const due = now() + 10 * HOUR;
		const t = ticket(due);
		const r = extendTicketTime(t.id, t.owner, 24, 'Waiting for credentials');
		expect(r).toEqual({ previousDue: due, newDue: due + 24 * HOUR });
		expect(dueOf(t.id)).toBe(due + 24 * HOUR);
		const list = listTicketExtensions(t.id);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ hours: 24, reason: 'Waiting for credentials', previous_due: due, new_due: due + 24 * HOUR, user_email: 'ext-owner@hilo.test' });
	});

	it('gives an overdue ticket a full extra window counted from now', () => {
		const t = ticket(now() - 30 * HOUR);
		const r = extendTicketTime(t.id, t.owner, 48, 'Late because of holidays');
		expect(r).not.toBeNull();
		expect(Math.abs(dueOf(t.id) - (now() + 48 * HOUR))).toBeLessThan(5);
	});

	it('stacks several extensions, newest first', () => {
		const due = now() + 5 * HOUR;
		const t = ticket(due);
		extendTicketTime(t.id, t.owner, 24, 'first extension reason');
		extendTicketTime(t.id, t.owner, 72, 'second extension reason');
		expect(dueOf(t.id)).toBe(due + 96 * HOUR);
		expect(listTicketExtensions(t.id).map((e) => e.hours)).toEqual([72, 24]);
	});

	it('refuses closed tickets and tickets without a target, changing nothing', () => {
		const closed = ticket(now() + HOUR, 'closed');
		expect(extendTicketTime(closed.id, closed.owner, 24, 'reason long enough')).toBeNull();
		expect(listTicketExtensions(closed.id)).toHaveLength(0);
		const none = ticket(null);
		expect(extendTicketTime(none.id, none.owner, 24, 'reason long enough')).toBeNull();
		expect(dueOf(none.id)).toBeNull();
	});

	it('a later message restarts the clock as usual (the extension covers the current wait)', () => {
		const t = ticket(now() + 5 * HOUR);
		extendTicketTime(t.id, t.owner, 72, 'need much more time');
		appendMessage({ ticketId: t.id, senderId: t.owner, senderRole: 'user', body: 'hello' });
		expect(Math.abs(dueOf(t.id) - (now() + 72 * HOUR))).toBeLessThan(5);
	});
});
