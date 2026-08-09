import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	canAccessTicket,
	getMessagesForTicket,
	getTicket,
	getTicketProjects
} from '$lib/server/tickets';
import { fmtBytes } from '$lib/server/utils';

/**
 * GET /api/tickets/:id/export
 *
 * Renders the entire ticket as a Markdown document: header with metadata,
 * one section per message, attachments listed as filenames + sizes. Sent
 * as a download attachment so the caller can `Save as`.
 *
 * Available to anyone who can read the ticket (owner / member / admin).
 * Internal notes are included only for admins.
 */

function fmtDate(unix: number) {
	return new Date(unix * 1000).toISOString();
}


export const GET: RequestHandler = ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');
	const t = getTicket(id);
	if (!t) throw error(404, 'Not found');
	if (!canAccessTicket(locals.user, t)) throw error(403, 'Forbidden');

	const messages = getMessagesForTicket(id, {
		id: locals.user.id,
		role: locals.user.role
	});
	const projects = getTicketProjects(id);

	const md: string[] = [];
	md.push(`# Ticket #${t.id} · ${t.title}`);
	md.push('');
	md.push(`- **Owner**: ${t.user_email}`);
	md.push(`- **Status**: ${t.status}`);
	md.push(`- **Priority**: ${t.priority}`);
	if (projects.length) md.push(`- **Projects**: ${projects.map((p) => p.name).join(', ')}`);
	md.push(`- **Created**: ${fmtDate(t.created_at)}`);
	md.push(`- **Last update**: ${fmtDate(t.updated_at)}`);
	md.push('');
	md.push('---');
	md.push('');

	for (const m of messages) {
		const who = m.sender_role === 'admin' ? 'Admin' : m.sender_email;
		const flags: string[] = [];
		if (m.internal === 1) flags.push('internal');
		if (m.edited_at) flags.push('edited');
		if (m.deleted_at) flags.push('deleted');
		const flagStr = flags.length ? ` _(${flags.join(', ')})_` : '';
		md.push(`### ${fmtDate(m.created_at)} · ${who}${flagStr}`);
		md.push('');
		md.push(m.deleted_at ? '_(message deleted)_' : m.body || '_(empty body)_');
		if (m.attachments.length) {
			md.push('');
			md.push('**Attachments**:');
			for (const a of m.attachments) {
				md.push(`- ${a.filename} · ${fmtBytes(a.size_bytes)} · ${a.mime_type}`);
			}
		}
		md.push('');
		md.push('---');
		md.push('');
	}

	const body = md.join('\n');
	const filename = `hilo-ticket-${t.id}.md`;
	return new Response(body, {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Content-Length': String(Buffer.byteLength(body, 'utf8'))
		}
	});
};
