import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import {
	approveProject,
	listActiveProjects,
	listPendingProjects,
	listProjectsForUser,
	mergeProjects,
	renameProject
} from '../src/lib/server/tickets-projects';

function setup() {
	db.prepare(`DELETE FROM users WHERE email = 'pp-user@hilo.test'`).run();
	db.prepare(`DELETE FROM projects WHERE slug IN ('pp-requested','pp-existing')`).run();
	const user = Number(db.prepare(`INSERT INTO users (email, role) VALUES ('pp-user@hilo.test','user')`).run().lastInsertRowid);
	const pending = Number(
		db.prepare(`INSERT INTO projects (name, slug, status, created_by_user_id) VALUES ('PP Requested','pp-requested','pending',?)`).run(user).lastInsertRowid
	);
	const existing = Number(db.prepare(`INSERT INTO projects (name, slug) VALUES ('PP Existing','pp-existing')`).run().lastInsertRowid);
	const ticket = Number(db.prepare(`INSERT INTO tickets (user_id, title, priority) VALUES (?, 'pp ticket', 'normal')`).run(user).lastInsertRowid);
	db.prepare('INSERT INTO ticket_projects (ticket_id, project_id) VALUES (?, ?)').run(ticket, pending);
	return { user, pending, existing, ticket };
}
const projectsOf = (ticket: number) =>
	(db.prepare('SELECT project_id FROM ticket_projects WHERE ticket_id = ?').all(ticket) as { project_id: number }[]).map((r) => r.project_id);

describe('pending project requests', () => {
	it('stay out of every pick list until approved', () => {
		const s = setup();
		expect(listActiveProjects().some((p) => p.id === s.pending)).toBe(false);
		expect(listActiveProjects().some((p) => p.id === s.existing)).toBe(true);
		db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(s.user, s.pending);
		expect(listProjectsForUser(s.user).some((p) => p.id === s.pending)).toBe(false);
	});

	it('are listed for the admin with requester and tickets', () => {
		const s = setup();
		const row = listPendingProjects().find((p) => p.id === s.pending)!;
		expect(row.requested_by?.email).toBe('pp-user@hilo.test');
		expect(row.tickets.map((t) => t.id)).toEqual([s.ticket]);
	});

	it('approval activates the project and assigns the requester', () => {
		const s = setup();
		expect(approveProject(s.pending)).toEqual({ requesterId: s.user });
		expect(listActiveProjects().some((p) => p.id === s.pending)).toBe(true);
		expect(listProjectsForUser(s.user).some((p) => p.id === s.pending)).toBe(true);
		expect(listPendingProjects().some((p) => p.id === s.pending)).toBe(false);
		expect(approveProject(s.pending)).toBeNull();
		expect(approveProject(s.existing)).toBeNull();
	});

	it('can be renamed before approval', () => {
		const s = setup();
		renameProject(s.pending, 'PP Renamed');
		approveProject(s.pending);
		const row = db.prepare('SELECT name, status FROM projects WHERE id = ?').get(s.pending) as { name: string; status: string };
		expect(row).toEqual({ name: 'PP Renamed', status: 'active' });
	});

	it('moving tickets to an existing project removes the request', () => {
		const s = setup();
		mergeProjects(s.pending, s.existing);
		expect(projectsOf(s.ticket)).toEqual([s.existing]);
		expect(db.prepare('SELECT 1 FROM projects WHERE id = ?').get(s.pending)).toBeUndefined();
	});
});
