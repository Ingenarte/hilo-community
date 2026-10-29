import { DEFAULT_PRIORITY, checkUrgentRequest, isPriority } from '$lib/sla';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	addAttachment,
	appendMessage,
	createTicket,
	getAdminUser,
	listActiveProjects,
	listProjectsForUser
} from '$lib/server/tickets';
import { isGroupValidForProjects, listGroupsForProject } from '$lib/server/groups';
import { db } from '$lib/server/db';
import { config } from '$lib/server/env';
import { broadcast } from '$lib/server/sse';
import { fanOutMessageNotification } from '$lib/server/notify';
import { isAllowedMime, saveUploadedFile } from '$lib/server/uploads';
import { dispatchWebhooks } from '$lib/server/webhooks';
import { audit } from '$lib/server/audit';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	// Archived projects never take new tickets, for admins either.
	const projects =
		locals.user.role === 'admin'
			? listActiveProjects()
			: listProjectsForUser(locals.user.id);
	// Admin can create a ticket "on behalf of" any active user — the picker
	// shows up only for admins in the new-ticket UI. The current admin is
	// excluded: admins cannot own tickets themselves under this model.
	const users =
		locals.user.role === 'admin'
			? (db
					.prepare(
						`SELECT id, email FROM users
						 WHERE disabled_at IS NULL AND id != ?
						 ORDER BY role = 'admin' DESC, email`
					)
					.all(locals.user.id) as Array<{ id: number; email: string }>)
			: [];
	// All groups across the visible projects, so the client can populate the
	// "Group" picker after the user ticks one or more projects. For admins
	// that means every group in the catalogue; for regular users we only
	// expose groups inside their assigned projects.
	const groups = projects.flatMap((p) =>
		listGroupsForProject(p.id).map((g) => ({
			id: g.id,
			name: g.name,
			project_id: g.project_id,
			project_name: p.name
		}))
	);
	return { projects, users, groups };
};

function slugify(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
}

/**
 * Map form-submitted project names to ids, enforcing per-user access:
 *  - Existing project AND user is in `user_projects` (or admin) → reuse.
 *  - Existing project AND user is NOT in `user_projects` → 403.
 *  - Name does NOT match any project → create as `status='active'`,
 *    set `created_by_user_id`, auto-assign the user. Admin can rename
 *    or archive from /admin/projects.
 */
function resolveProjectsForUser(
	names: string[],
	user: { id: number; role: 'user' | 'admin' }
): number[] {
	const ids: number[] = [];
	const seen = new Set<string>();
	const findStmt = db.prepare('SELECT id, status FROM projects WHERE name = ? COLLATE NOCASE');
	const assignStmt = db.prepare(
		'SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?'
	);
	const slugStmt = db.prepare('SELECT 1 FROM projects WHERE slug = ?');
	const insertProjectStmt = db.prepare(
		`INSERT INTO projects (name, slug, status, created_by_user_id)
		 VALUES (?, ?, 'active', ?)`
	);
	const insertAssignmentStmt = db.prepare(
		'INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)'
	);

	for (const raw of names) {
		const name = raw.trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);

		const found = findStmt.get(name) as { id: number; status: string } | undefined;
		if (found) {
			if (found.status === 'archived') {
				throw error(400, `Project "${name}" is archived and does not accept new tickets.`);
			}
			if (user.role !== 'admin' && !assignStmt.get(user.id, found.id)) {
				throw error(403, `You are not assigned to project "${name}".`);
			}
			ids.push(found.id);
			continue;
		}

		// New project — create as active, auto-assign the creator.
		let slug = slugify(name);
		let suffix = 0;
		while (slugStmt.get(slug)) {
			suffix += 1;
			slug = `${slugify(name)}-${suffix}`;
		}
		const info = insertProjectStmt.run(name, slug, user.id);
		const newId = Number(info.lastInsertRowid);
		insertAssignmentStmt.run(user.id, newId);
		ids.push(newId);
	}
	return ids;
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(303, '/login');
		}

		const form = await request.formData();
		const title = String(form.get('title') || '').trim();
		const body = String(form.get('body') || '').trim();
		// Project names come from two places in the UI: ticked checkboxes (the
		// dropdown filtered by user_projects) and free-text "+ Add" entries.
		// Both arrive under the same `projects` field. The server resolves
		// each name with per-user access checks (see resolveProjectsForUser).
		const projectNames = form
			.getAll('projects')
			.map((v) => String(v).trim())
			.filter(Boolean);
		const priorityRaw = String(form.get('priority') || DEFAULT_PRIORITY);
		const files = form
			.getAll('files')
			.filter((f): f is File => f instanceof File && f.size > 0);

		if (!isPriority(priorityRaw))
			return fail(400, { error: 'Pick a valid priority.', title, body });
		let priorityReason: string | null = null;
		if (priorityRaw === 'urgent') {
			const check = checkUrgentRequest(form.get('priorityReason'), form.get('confirmUrgent'));
			if (!check.ok) return fail(400, { error: check.error, title, body });
			priorityReason = check.reason;
		}

		if (!title) return fail(400, { error: 'Please give your ticket a short title.', title, body });
		if (!body) return fail(400, { error: 'Please write your first message.', title, body });
		// Project is mandatory: either pick one from the user's assigned list
		// or type a new name via "+ Add" (which gets created as pending and
		// auto-assigned).
		if (projectNames.length === 0)
			return fail(400, {
				error: 'Pick a project from the list, or use “+ Add project” to request a new one.',
				title,
				body
			});

		const maxBytes = config.maxUploadMb * 1024 * 1024;
		for (const f of files) {
			if (f.size > maxBytes) {
				return fail(413, {
					error: `${f.name} exceeds the ${config.maxUploadMb} MB limit.`,
					title,
					body
				});
			}
			if (!isAllowedMime(f.type)) {
				return fail(415, { error: `${f.name} has unsupported type ${f.type}.`, title, body });
			}
		}

		// Admin MUST create on behalf of another user — the picked user
		// becomes the ticket owner (tickets.user_id) and is the only one
		// (besides admins) who will see the ticket. Regular users always
		// own their own tickets and any `userId` they submit is ignored.
		let ownerId = locals.user.id;
		let ownerEmail = locals.user.email;
		if (locals.user.role === 'admin') {
			const submittedUserId = Number(form.get('userId') ?? 0);
			if (!submittedUserId || submittedUserId === locals.user.id) {
				return fail(400, {
					error: 'Pick the user this ticket is for. Admins cannot create tickets owned by themselves.',
					title,
					body
				});
			}
			const row = db
				.prepare('SELECT id, email FROM users WHERE id = ? AND disabled_at IS NULL')
				.get(submittedUserId) as { id: number; email: string } | undefined;
			if (!row) {
				return fail(400, { error: 'Selected user does not exist or is disabled.', title, body });
			}
			ownerId = row.id;
			ownerEmail = row.email;
		}

		const projectIds = resolveProjectsForUser(projectNames, locals.user);

		// Optional group: when present, it must belong to one of the picked
		// projects. Group attachment is what grants visibility to other
		// users inside the same group; without it the ticket is visible
		// only to owner/assignee/follower/admin.
		const rawGroupId = form.get('groupId');
		let groupId: number | null = null;
		if (rawGroupId !== null && String(rawGroupId).trim() !== '') {
			const candidate = Number(rawGroupId);
			if (!Number.isFinite(candidate) || candidate <= 0) {
				return fail(400, { error: 'Invalid group selection.', title, body });
			}
			if (!isGroupValidForProjects(candidate, projectIds)) {
				return fail(400, {
					error: 'Selected group does not belong to the chosen project(s).',
					title,
					body
				});
			}
			groupId = candidate;
		}

		const ticketId = createTicket({
			userId: ownerId,
			title,
			projectIds,
			groupId,
			priority: priorityRaw,
			priorityReason
		});
		audit('ticket.created', {
			actor: locals.user,
			target: `ticket:${ticketId}`,
			detail: { title, projects: projectNames, ownerId, ownerEmail, priority: priorityRaw, priorityReason }
		});
		const messageId = appendMessage({
			ticketId,
			senderId: locals.user.id,
			senderRole: locals.user.role,
			body
		});

		const savedAttachments: Array<{
			id: number;
			filename: string;
			stored_name: string;
			mime_type: string;
			size_bytes: number;
		}> = [];
		for (const f of files) {
			const saved = await saveUploadedFile(f);
			const attachmentId = addAttachment({ messageId, ...saved });
			savedAttachments.push({
				id: attachmentId,
				filename: saved.filename,
				stored_name: saved.storedName,
				mime_type: saved.mimeType,
				size_bytes: saved.sizeBytes
			});
		}

		broadcast(ticketId, 'message', { id: messageId });

		// Fan-out: email + web push + SSE activity ping. Webhooks are
		// dispatched separately below because the event name is route-specific.
		fanOutMessageNotification({
			ticketId,
			ticketTitle: title,
			authorEmail: locals.user.email,
			authorRole: locals.user.role,
			body,
			attachments: savedAttachments,
			sseKind: 'ticket.new',
			fallbackPreview: '(new ticket)'
		}).catch((err) => console.error('[notify] fan-out failed', err));

		const ticketUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/tickets/${ticketId}`;
		dispatchWebhooks('ticket.new', {
			ticket_id: ticketId,
			title,
			priority: priorityRaw,
			status: 'open',
			author: locals.user.email,
			preview: body,
			url: ticketUrl,
			brand: config.brand
		});

		throw redirect(303, '/tickets');
	}
};
