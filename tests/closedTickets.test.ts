import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import { appendMessage, editMessage, softDeleteMessage, TicketClosedError } from '../src/lib/server/tickets-messages';
import { queryTickets, setTicketStatus } from '../src/lib/server/tickets';
import { enqueueTicketClosedNotice } from '../src/lib/server/welcome';

function setup(status = 'closed') {
	db.prepare(`DELETE FROM users WHERE email IN ('cl-owner@hilo.test','cl-admin@hilo.test')`).run();
	const owner = Number(db.prepare(`INSERT INTO users (email, role) VALUES ('cl-owner@hilo.test','user')`).run().lastInsertRowid);
	const admin = Number(db.prepare(`INSERT INTO users (email, role) VALUES ('cl-admin@hilo.test','admin')`).run().lastInsertRowid);
	const ticket = Number(
		db.prepare(`INSERT INTO tickets (user_id, title, priority, status, sla_due_at) VALUES (?, 'closed test', 'normal', ?, ?)`).run(owner, status, Math.floor(Date.now() / 1000) + 3600).lastInsertRowid
	);
	return { owner, admin, ticket };
}
const statusOf = (id: number) => (db.prepare('SELECT status FROM tickets WHERE id = ?').get(id) as { status: string }).status;
const count = (id: number) => (db.prepare('SELECT COUNT(*) n FROM messages WHERE ticket_id = ?').get(id) as { n: number }).n;

describe('closed tickets', () => {
	it('refuse messages from users and change nothing', () => {
		const s = setup('closed');
		expect(() => appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'hello?' })).toThrow(TicketClosedError);
		expect(count(s.ticket)).toBe(0);
		expect(statusOf(s.ticket)).toBe('closed');
	});

	it('still take messages and internal notes from admins, without reopening', () => {
		const s = setup('closed');
		appendMessage({ ticketId: s.ticket, senderId: s.admin, senderRole: 'admin', body: 'one more thing' });
		appendMessage({ ticketId: s.ticket, senderId: s.admin, senderRole: 'admin', body: 'note', internal: true });
		expect(count(s.ticket)).toBe(2);
		expect(statusOf(s.ticket)).toBe('closed');
	});

	it('open tickets take user messages as always', () => {
		const s = setup('open');
		appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'hi' });
		expect(count(s.ticket)).toBe(1);
	});

	it('become writable for the user again once an admin reopens them', () => {
		const s = setup('closed');
		setTicketStatus(s.ticket, 'open');
		appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'thanks' });
		expect(count(s.ticket)).toBe(1);
	});

	it('the courtesy notice for an emailed reply is sent once a day per person and ticket', () => {
		const s = setup('closed');
		db.prepare('DELETE FROM email_outbox').run();
		expect(enqueueTicketClosedNotice({ userId: s.owner, toEmail: 'cl-owner@hilo.test', ticketId: s.ticket, title: 'closed test' })).toBe(true);
		expect(enqueueTicketClosedNotice({ userId: s.owner, toEmail: 'cl-owner@hilo.test', ticketId: s.ticket, title: 'closed test' })).toBe(false);
		const rows = db.prepare('SELECT subject, text_body FROM email_outbox').all() as Array<{ subject: string; text_body: string }>;
		expect(rows).toHaveLength(1);
		expect(rows[0].subject).toContain(`#${s.ticket} is closed`);
		expect(rows[0].text_body).toContain('/tickets/new');
	});
});

describe('closed tickets are frozen for users', () => {
	it('users cannot edit or delete their own messages once the ticket is closed', () => {
		const s = setup('open');
		const id = appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'draft one' });
		db.prepare("UPDATE tickets SET status = 'closed' WHERE id = ?").run(s.ticket);
		expect(editMessage({ messageId: id, body: 'changed', by: { id: s.owner, role: 'user' } })).toBe(false);
		expect(softDeleteMessage({ messageId: id, by: { id: s.owner, role: 'user' } })).toBe(false);
		const row = db.prepare('SELECT body, deleted_at, edited_at FROM messages WHERE id = ?').get(id) as { body: string; deleted_at: number | null; edited_at: number | null };
		expect(row).toEqual({ body: 'draft one', deleted_at: null, edited_at: null });
	});

	it('an admin still can, and users can again after a reopen', () => {
		const s = setup('open');
		const id = appendMessage({ ticketId: s.ticket, senderId: s.owner, senderRole: 'user', body: 'draft two' });
		db.prepare("UPDATE tickets SET status = 'closed' WHERE id = ?").run(s.ticket);
		expect(editMessage({ messageId: id, body: 'fixed by admin', by: { id: s.admin, role: 'admin' } })).toBe(true);
		setTicketStatus(s.ticket, 'open');
		expect(editMessage({ messageId: id, body: 'mine again', by: { id: s.owner, role: 'user' } })).toBe(true);
		expect(softDeleteMessage({ messageId: id, by: { id: s.owner, role: 'user' } })).toBe(true);
	});
});

describe('inbox default hides closed tickets', () => {
	it("status 'active' lists open and pending only; 'any' and 'closed' still work", () => {
		const s = setup('open');
		const mk = (status: string) =>
			Number(db.prepare(`INSERT INTO tickets (user_id, title, priority, status) VALUES (?, ?, 'normal', ?)`).run(s.owner, `ACT ${status}`, status).lastInsertRowid);
		const open = mk('open'), pending = mk('pending'), closed = mk('closed');
		const ids = (status: 'active' | 'any' | 'closed') =>
			queryTickets({ ownerId: s.owner, status, limit: 100 }).tickets.map((t) => t.id);
		expect(ids('active')).toEqual(expect.arrayContaining([open, pending]));
		expect(ids('active')).not.toContain(closed);
		expect(ids('any')).toEqual(expect.arrayContaining([open, pending, closed]));
		expect(ids('closed')).toContain(closed);
		expect(ids('closed')).not.toContain(open);
	});
});
