import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import { authenticateToken, createApiToken } from '../src/lib/server/apiTokens';
import { TicketCreateError, openTicket } from '../src/lib/server/ticketCreate';
import { getTicket } from '../src/lib/server/tickets';
import { buildAgentBrief } from '../src/lib/agentBrief';
import { POST as createViaApi } from '../src/routes/api/v1/tickets/+server';

type Role = 'user' | 'admin';

function setup() {
	const tag = Math.random().toString(36).slice(2, 8);
	const mk = (role: Role) => {
		const email = `ct-${role}-${tag}@hilo.test`;
		const id = Number(db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(email, role).lastInsertRowid);
		return { id, email, role, theme: 'dark' as const, accent: 'violet' as const };
	};
	const mkProject = (status = 'active') =>
		Number(
			db
				.prepare('INSERT INTO projects (name, slug, status) VALUES (?, ?, ?)')
				.run(`CT ${tag} ${status} ${Math.random()}`, `ct-${tag}-${Math.random().toString(36).slice(2, 8)}`, status)
				.lastInsertRowid
		);
	const user = mk('user');
	const admin = mk('admin');
	const project = mkProject();
	const other = mkProject();
	const archived = mkProject('archived');
	db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(user.id, project);
	db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(user.id, archived);
	const slug = (db.prepare('SELECT slug FROM projects WHERE id = ?').get(project) as { slug: string }).slug;
	return { user, admin, project, other, archived, slug };
}

function statusOf(fn: () => unknown): number | null {
	try {
		fn();
		return null;
	} catch (err) {
		return err instanceof TicketCreateError ? err.status : -1;
	}
}

async function call(token: string, payload: unknown, contentType = 'application/json') {
	const auth = authenticateToken(token)!;
	const request = new Request('http://localhost/api/v1/tickets', {
		method: 'POST',
		headers: { 'content-type': contentType },
		body: JSON.stringify(payload)
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const res = (await createViaApi({ locals: { user: auth.user, apiToken: auth.info }, request } as any)) as Response;
	return { status: res.status, body: await res.json() };
}

describe('openTicket (shared by /api/tickets and /api/v1/tickets)', () => {
	it('validates title, body, priority and project like the UI endpoint', () => {
		const s = setup();
		expect(statusOf(() => openTicket(s.user, { body: 'x', projectId: s.project }))).toBe(400);
		expect(statusOf(() => openTicket(s.user, { title: 'x', projectId: s.project }))).toBe(400);
		expect(statusOf(() => openTicket(s.user, { title: 'x', body: 'y', priority: 'asap', projectId: s.project }))).toBe(400);
		expect(statusOf(() => openTicket(s.user, { title: 'x', body: 'y', priority: 'urgent', projectId: s.project }))).toBe(400);
		expect(statusOf(() => openTicket(s.user, { title: 'x', body: 'y' }))).toBe(400);
		expect(statusOf(() => openTicket(s.user, { title: 'x', body: 'y', projectId: s.other }))).toBe(403);
		expect(statusOf(() => openTicket(s.user, { title: 'x', body: 'y', projectId: s.archived }))).toBe(400);
		expect(statusOf(() => openTicket(s.user, { title: 'x', body: 'y', projectId: 99999999 }))).toBe(404);
	});

	it('opens pending tickets for users and approved tickets for admins', () => {
		const s = setup();
		const u = openTicket(s.user, { title: 'from user', body: 'b', projectId: s.project });
		expect(u.approval).toBe('pending');
		expect(getTicket(u.ticketId)!.sla_due_at).toBeNull();
		const a = openTicket(s.admin, { title: 'from admin', body: 'b', projectId: s.other, priority: 'high' });
		expect(a.approval).toBe('approved');
		expect(getTicket(a.ticketId)!.priority).toBe('high');
		expect(getTicket(a.ticketId)!.sla_due_at).not.toBeNull();
	});
});

describe('can_create tokens', () => {
	it('stores and resolves the capability and the project restriction', () => {
		const s = setup();
		const { token, info } = createApiToken({ userId: s.user.id, name: 't', canReply: false, canCreate: true, projectId: s.project });
		expect(info.can_create).toBe(true);
		expect(info.project_id).toBe(s.project);
		const auth = authenticateToken(token)!;
		expect(auth.info.canCreate).toBe(true);
		expect(auth.info.projectId).toBe(s.project);
		const plain = createApiToken({ userId: s.user.id, name: 'p', canReply: true });
		expect(authenticateToken(plain.token)!.info.canCreate).toBe(false);
	});

	it('POST /api/v1/tickets: 201 with id and url, body stored as first message', async () => {
		const s = setup();
		const { token } = createApiToken({ userId: s.admin.id, name: 'c', canReply: false, canCreate: true });
		const res = await call(token, { title: 'API ticket', body: 'Details here', project_slug: s.slug });
		expect(res.status).toBe(201);
		expect(res.body.id).toBeGreaterThan(0);
		expect(res.body.url).toMatch(new RegExp(`/tickets/${res.body.id}$`));
		expect(res.body.approval_status).toBe('approved');
		const msg = db.prepare('SELECT body, via_token_id FROM messages WHERE ticket_id = ?').get(res.body.id) as {
			body: string;
			via_token_id: number;
		};
		expect(msg.body).toBe('Details here');
		expect(msg.via_token_id).not.toBeNull();
	});

	it('rejects tokens without the capability, wrong projects and bad payloads', async () => {
		const s = setup();
		const readOnly = createApiToken({ userId: s.user.id, name: 'r', canReply: true });
		expect((await call(readOnly.token, { title: 'x', body: 'y', project_id: s.project })).status).toBe(403);

		const scoped = createApiToken({ userId: s.user.id, name: 's', canReply: false, canCreate: true, projectId: s.project });
		expect((await call(scoped.token, { title: 'x', body: 'y', project_id: s.other })).status).toBe(403);
		expect((await call(scoped.token, { title: 'x', body: 'y' }, 'text/plain')).status).toBe(415);
		expect((await call(scoped.token, { body: 'y' })).status).toBe(400);
		const ok = await call(scoped.token, { title: 'defaults to token project', body: 'y' });
		expect(ok.status).toBe(201);
		expect(ok.body.project_id).toBe(s.project);
		expect(ok.body.approval_status).toBe('pending');
	});

	it('rate limits ticket creation per token', async () => {
		const s = setup();
		const { token } = createApiToken({ userId: s.admin.id, name: 'rl', canReply: false, canCreate: true, projectId: s.project });
		const statuses: number[] = [];
		for (let i = 0; i < 6; i++) statuses.push((await call(token, { title: `t${i}`, body: 'b' })).status);
		expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
		expect(statuses[5]).toBe(429);
	});
});

describe('agent brief for can_create tokens', () => {
	const base = { baseUrl: 'https://hilo.example.com', token: 'hilo_T', expiresAt: 1_800_000_000, canReply: false };

	it('documents the create call only when the capability is present', () => {
		expect(buildAgentBrief({ ...base, ticketId: null })).not.toContain('Open a ticket');
		const brief = buildAgentBrief({ ...base, ticketId: null, canCreate: true });
		expect(brief).toContain('## Open a ticket');
		expect(brief).toContain('https://hilo.example.com/api/v1/tickets');
		expect(brief).toContain('project_slug');
		expect(brief).toContain('/attachments');
		const scoped = buildAgentBrief({ ...base, ticketId: null, canCreate: true, projectId: 7 });
		expect(scoped).toContain('"project_id":7');
		expect(scoped).toContain('may open tickets in project 7');
	});
});
