import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { appendMessage } from '../src/lib/server/tickets-messages';
import { setTicketPriority, setTicketStatus } from '../src/lib/server/tickets';

const now = () => Math.floor(Date.now() / 1000);
const HOUR = 3600;

function setup(priority: 'urgent' | 'high' | 'normal' | 'low' = 'normal') {
	db.prepare(`DELETE FROM users WHERE email IN ('sla-owner@hilo.test','sla-admin@hilo.test')`).run();
	const owner = Number(db.prepare(`INSERT INTO users (email, role) VALUES ('sla-owner@hilo.test','user')`).run().lastInsertRowid);
	const admin = Number(db.prepare(`INSERT INTO users (email, role) VALUES ('sla-admin@hilo.test','admin')`).run().lastInsertRowid);
	const created = now() - 100 * HOUR;
	const ticket = Number(
		db
			.prepare(`INSERT INTO tickets (user_id, title, priority, created_at, sla_due_at) VALUES (?, 'sla test', ?, ?, ?)`)
			.run(owner, priority, created, created + 72 * HOUR).lastInsertRowid
	);
	return { owner, admin, ticket, created };
}
const due = (id: number) => (db.prepare('SELECT sla_due_at AS d FROM tickets WHERE id = ?').get(id) as { d: number }).d;

describe('response target restarts with every public message', () => {
	let s: ReturnType<typeof setup>;
	beforeEach(() => {
		s = setup('normal');
	});

	it('a reply from the user restarts the 72 h clock', () => {
		expect(due(s.ticket)).toBeLessThan(now()); // starts overdue
		appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'hello' });
		expect(Math.abs(due(s.ticket) - (now() + 72 * HOUR))).toBeLessThan(5);
	});

	it('a reply from an admin restarts it too', () => {
		appendMessage({ ticketId: s.ticket, senderId: s.admin, senderRole: 'admin', body: 'answer' });
		expect(Math.abs(due(s.ticket) - (now() + 72 * HOUR))).toBeLessThan(5);
	});

	it('an internal note does not restart it', () => {
		const before = due(s.ticket);
		appendMessage({ ticketId: s.ticket, senderId: s.admin, senderRole: 'admin', body: 'note', internal: true });
		expect(due(s.ticket)).toBe(before);
	});

	it('uses the hours of the ticket priority', () => {
		for (const [p, h] of [['urgent', 24], ['high', 48], ['normal', 72], ['low', 96]] as const) {
			const t = setup(p);
			appendMessage({ ticketId: t.ticket, senderId: t.owner, senderRole: 'user', body: 'x' });
			expect(Math.abs(due(t.ticket) - (now() + h * HOUR))).toBeLessThan(5);
		}
	});

	it('changing the priority counts from the last public message, not from creation', () => {
		const msg = appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'x' });
		const tenHoursAgo = now() - 10 * HOUR;
		db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(tenHoursAgo, msg);
		setTicketPriority(s.ticket, 'urgent', 'a sufficiently long reason');
		expect(due(s.ticket)).toBe(tenHoursAgo + 24 * HOUR);
		setTicketPriority(s.ticket, 'low');
		expect(due(s.ticket)).toBe(tenHoursAgo + 96 * HOUR);
	});

	it('internal notes are ignored when the priority changes', () => {
		const pub = appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'x' });
		const note = appendMessage({ ticketId: s.ticket, senderId: s.admin, senderRole: 'admin', body: 'n', internal: true });
		db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(now() - 20 * HOUR, pub);
		db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(now() - 1 * HOUR, note);
		setTicketPriority(s.ticket, 'high');
		expect(due(s.ticket)).toBe(now() - 20 * HOUR + 48 * HOUR);
	});

	it('reopening a closed ticket restarts the clock; closing does not touch it', () => {
		setTicketStatus(s.ticket, 'closed');
		const closedDue = due(s.ticket);
		expect(closedDue).toBe(s.created + 72 * HOUR);
		setTicketStatus(s.ticket, 'open');
		expect(Math.abs(due(s.ticket) - (now() + 72 * HOUR))).toBeLessThan(5);
	});

	it('a ticket without a target (created before the feature) gets one on its first message', () => {
		db.prepare('UPDATE tickets SET sla_due_at = NULL WHERE id = ?').run(s.ticket);
		appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'x' });
		expect(Math.abs(due(s.ticket) - (now() + 72 * HOUR))).toBeLessThan(5);
	});
});
