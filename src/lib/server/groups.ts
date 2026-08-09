/**
 * Groups — sub-units inside a project. Created by admins; each group
 * holds a set of users (group_users) and grants visibility to any ticket
 * tagged with that group (tickets.group_id).
 *
 * The application layer enforces:
 *  - a ticket's group_id must belong to one of the ticket's projects
 *  - on group delete, dependent tickets keep their row but lose group_id
 */
import { db } from './db';

export type Group = {
	id: number;
	project_id: number;
	name: string;
	created_by_user_id: number | null;
	created_at: number;
};

export type GroupWithCounts = Group & {
	member_count: number;
	ticket_count: number;
	project_name: string;
};

export type GroupMember = { id: number; email: string; role: 'user' | 'admin' };

export function listGroupsForProject(projectId: number): Group[] {
	return db
		.prepare('SELECT * FROM groups WHERE project_id = ? ORDER BY name')
		.all(projectId) as Group[];
}

export function listGroupsForUser(userId: number): Group[] {
	return db
		.prepare(
			`SELECT g.* FROM groups g
			 JOIN group_users gu ON gu.group_id = g.id
			 WHERE gu.user_id = ?
			 ORDER BY g.name`
		)
		.all(userId) as Group[];
}

export function listAllGroupsWithCounts(): GroupWithCounts[] {
	return db
		.prepare(
			`SELECT g.*,
			        p.name AS project_name,
			        (SELECT COUNT(*) FROM group_users WHERE group_id = g.id) AS member_count,
			        (SELECT COUNT(*) FROM tickets    WHERE group_id = g.id) AS ticket_count
			 FROM groups g
			 JOIN projects p ON p.id = g.project_id
			 ORDER BY p.name, g.name`
		)
		.all() as GroupWithCounts[];
}

export function getGroup(id: number): Group | null {
	const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Group | undefined;
	return row ?? null;
}

export function createGroup(args: {
	projectId: number;
	name: string;
	createdByUserId: number;
}): Group {
	const name = args.name.trim();
	if (!name) throw new Error('Group name is required');
	if (name.length > 80) throw new Error('Group name too long (max 80)');
	const project = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(args.projectId);
	if (!project) throw new Error('Project not found');
	const info = db
		.prepare(
			`INSERT INTO groups (project_id, name, created_by_user_id) VALUES (?, ?, ?)`
		)
		.run(args.projectId, name, args.createdByUserId);
	return getGroup(Number(info.lastInsertRowid))!;
}

export function renameGroup(id: number, name: string): void {
	const clean = name.trim();
	if (!clean) throw new Error('Group name is required');
	db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(clean, id);
}

export function deleteGroup(id: number): void {
	// Tickets keep their row but the group_id is detached so they revert
	// to owner/assignee/follower-only visibility.
	const trx = db.transaction(() => {
		db.prepare('UPDATE tickets SET group_id = NULL WHERE group_id = ?').run(id);
		db.prepare('DELETE FROM groups WHERE id = ?').run(id);
	});
	trx();
}

export function listGroupMembers(groupId: number): GroupMember[] {
	return db
		.prepare(
			`SELECT u.id, u.email, u.role
			 FROM users u JOIN group_users gu ON gu.user_id = u.id
			 WHERE gu.group_id = ? AND u.disabled_at IS NULL
			 ORDER BY u.role = 'admin' DESC, u.email`
		)
		.all(groupId) as GroupMember[];
}

export function setGroupMembers(groupId: number, userIds: number[]): void {
	const trx = db.transaction(() => {
		db.prepare('DELETE FROM group_users WHERE group_id = ?').run(groupId);
		const ins = db.prepare(
			'INSERT OR IGNORE INTO group_users (group_id, user_id) VALUES (?, ?)'
		);
		// only add users that actually exist and are not disabled
		const ok = db.prepare('SELECT id FROM users WHERE id = ? AND disabled_at IS NULL');
		for (const uid of userIds) {
			if (ok.get(uid)) ins.run(groupId, uid);
		}
	});
	trx();
}

export function addGroupMember(groupId: number, userId: number): void {
	db.prepare('INSERT OR IGNORE INTO group_users (group_id, user_id) VALUES (?, ?)').run(
		groupId,
		userId
	);
}

export function removeGroupMember(groupId: number, userId: number): void {
	db.prepare('DELETE FROM group_users WHERE group_id = ? AND user_id = ?').run(groupId, userId);
}

/**
 * Validates that a group can be attached to a ticket given its projects:
 * the group must exist and its project_id must appear among the ticket's
 * project ids.
 */
export function isGroupValidForProjects(groupId: number, projectIds: number[]): boolean {
	if (projectIds.length === 0) return false;
	const placeholders = projectIds.map(() => '?').join(',');
	const row = db
		.prepare(`SELECT 1 FROM groups WHERE id = ? AND project_id IN (${placeholders})`)
		.get(groupId, ...projectIds);
	return !!row;
}
