import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import { appendMessage, TicketClosedError, TicketNotApprovedError } from '../src/lib/server/tickets-messages';
import { approveTicket, canAccessTicket, countPendingApproval, createTicket, getTicket, queryTickets, rejectTicket } from '../src/lib/server/tickets';

function setup() {
	db.prepare(`DELETE FROM users WHERE email LIKE 'ap-%@hilo.test'`).run();
	const mk = (email: string, role: string) =>
		Number(db.prepare(`INSERT INTO users (email, role) VALUES (?, ?)`).run(email, role).lastInsertRowid);
	const owner = mk('ap-owner@hilo.test', 'user');
	const other = mk('ap-other@hilo.test', 'user');
	const admin = mk('ap-admin@hilo.test', 'admin');
	const project = Number(db.prepare(`INSERT INTO projects (name, slug) VALUES ('AP proj ' || abs(random()), 'ap-proj-' || abs(random()))`).run().lastInsertRowid);
	const ticket = createTicket({ userId: owner, title: 'needs approval', projectIds: [project], approval: 'pending' });
	db.prepare('INSERT INTO ticket_followers (ticket_id, email) VALUES (?, ?)').run(ticket, 'ap-other@hilo.test');
	return { owner, other, admin, ticket };
}

describe('ticket approval', () => {
	it('a pending ticket has no response clock and takes only the first message', () => {
		const s = setup();
		const t = getTicket(s.ticket)!;
		expect(t.approval_status).toBe('pending');
		expect(t.sla_due_at).toBeNull();
		appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'first', allowUnapproved: true });
		expect(() => appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'more' })).toThrow(TicketNotApprovedError);
		appendMessage({ ticketId: s.ticket, senderId: s.admin, senderRole: 'admin', body: 'admin may write' });
		expect(getTicket(s.ticket)!.sla_due_at).toBeNull();
	});

	it('is private to its owner and admins until approved', () => {
		const s = setup();
		const t = getTicket(s.ticket)!;
		const user = (id: number, email: string) => ({ id, email, role: 'user' as const });
		expect(canAccessTicket(user(s.owner, 'ap-owner@hilo.test'), t)).toBe(true);
		expect(canAccessTicket(user(s.other, 'ap-other@hilo.test'), t)).toBe(false);
		expect(queryTickets({ userId: s.other, userEmail: 'ap-other@hilo.test' }).tickets.some((x) => x.id === s.ticket)).toBe(false);
		expect(queryTickets({ userId: s.owner }).tickets.some((x) => x.id === s.ticket)).toBe(true);
		expect(queryTickets({ approval: 'pending' }).tickets.some((x) => x.id === s.ticket)).toBe(true);
		expect(countPendingApproval()).toBeGreaterThan(0);
	});

	it('approval starts the clock, opens it to the others and allows replies', () => {
		const s = setup();
		expect(approveTicket(s.ticket, s.admin)).toBe(true);
		const t = getTicket(s.ticket)!;
		expect(t.approval_status).toBe('approved');
		expect(t.sla_due_at).not.toBeNull();
		expect(canAccessTicket({ id: s.other, email: 'ap-other@hilo.test', role: 'user' }, t)).toBe(true);
		appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'now ok' });
		expect(approveTicket(s.ticket, s.admin)).toBe(false);
		expect(rejectTicket(s.ticket, s.admin, 'too late')).toBe(false);
	});

	it('rejection closes the ticket with the reason and keeps it read-only', () => {
		const s = setup();
		expect(rejectTicket(s.ticket, s.admin, 'Out of scope for your plan')).toBe(true);
		const t = getTicket(s.ticket)!;
		expect(t.approval_status).toBe('rejected');
		expect(t.approval_reason).toBe('Out of scope for your plan');
		expect(t.status).toBe('closed');
		expect(() => appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'hello?' })).toThrow(TicketClosedError);
		expect(approveTicket(s.ticket, s.admin)).toBe(false);
	});
});
