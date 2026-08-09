import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import type { DBTicket } from '$lib/server/db';

function csvCell(v: unknown): string {
	const s = v === null || v === undefined ? '' : String(v);
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

/**
 * GET /api/admin/export.csv
 * Streams a CSV of every ticket with author email, projects (joined),
 * message count, and timestamps. Admin-only.
 */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden');

	const rows = db
		.prepare(
			`SELECT t.id, t.title, t.status, t.priority, t.created_at, t.updated_at,
			        u.email AS user_email,
			        (SELECT COUNT(*) FROM messages m WHERE m.ticket_id = t.id) AS message_count,
			        (SELECT MAX(created_at) FROM messages m WHERE m.ticket_id = t.id) AS last_message_at,
			        (SELECT GROUP_CONCAT(p.name, '|')
			           FROM projects p
			           JOIN ticket_projects tp ON tp.project_id = p.id
			          WHERE tp.ticket_id = t.id) AS projects
			 FROM tickets t JOIN users u ON u.id = t.user_id
			 ORDER BY t.id`
		)
		.all() as Array<
		Pick<DBTicket, 'id' | 'title' | 'status' | 'priority' | 'created_at' | 'updated_at'> & {
			user_email: string;
			message_count: number;
			last_message_at: number | null;
			projects: string | null;
		}
	>;

	const header = [
		'id',
		'title',
		'status',
		'priority',
		'user_email',
		'projects',
		'messages',
		'created_at',
		'updated_at',
		'last_message_at'
	];

	const lines: string[] = [header.join(',')];
	for (const r of rows) {
		lines.push(
			[
				r.id,
				csvCell(r.title),
				r.status,
				r.priority,
				csvCell(r.user_email),
				csvCell((r.projects ?? '').replaceAll('|', '; ')),
				r.message_count,
				new Date(r.created_at * 1000).toISOString(),
				new Date(r.updated_at * 1000).toISOString(),
				r.last_message_at ? new Date(r.last_message_at * 1000).toISOString() : ''
			].join(',')
		);
	}

	const body = lines.join('\n') + '\n';
	const stamp = new Date().toISOString().slice(0, 10);
	return new Response(body, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="hilo-tickets-${stamp}.csv"`
		}
	});
};
