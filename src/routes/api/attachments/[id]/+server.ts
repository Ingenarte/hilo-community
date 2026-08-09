import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { db } from '$lib/server/db';
import { canAccessTicket, getAttachment } from '$lib/server/tickets';
import { uploadPath } from '$lib/server/uploads';

export const GET: RequestHandler = ({ params, locals, request }) => {
	if (!locals.user) throw redirect(303, '/login');
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(404, 'Not found');

	const att = getAttachment(id);
	if (!att) throw error(404, 'Not found');

	// Authorise: owner, admin, assignee, group member, or ticket follower.
	// SELECT includes assigned_to and group_id so canAccessTicket can evaluate
	// group membership and assignee access (finding D1).
	const row = db
		.prepare(
			`SELECT t.id, t.user_id, t.assigned_to, t.group_id FROM attachments a
			 JOIN messages m ON m.id = a.message_id
			 JOIN tickets t ON t.id = m.ticket_id
			 WHERE a.id = ?`
		)
		.get(id) as { id: number; user_id: number; assigned_to: number | null; group_id: number | null } | undefined;
	if (!row) throw error(404, 'Not found');
	if (!canAccessTicket(locals.user, row)) throw error(403, 'Forbidden');

	const filePath = uploadPath(att.stored_name);
	let totalSize = 0;
	try {
		totalSize = statSync(filePath).size;
	} catch {
		throw error(404, 'File missing');
	}

	const safeName = att.filename.replace(/[^\x20-\x7E]+/g, '_');
	const mimeType = att.mime_type || 'application/octet-stream';

	// ── Range request handling (RFC 7233) ──────────────────────────────────────
	const rangeHeader = request.headers.get('range');
	if (rangeHeader) {
		// Parse "bytes=<start>-<end>" where end is optional.
		const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
		if (!match) {
			// Malformed Range header → 416.
			return new Response(null, {
				status: 416,
				headers: {
					'Content-Range': `bytes */${totalSize}`,
					'Accept-Ranges': 'bytes'
				}
			});
		}
		const start = parseInt(match[1], 10);
		const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

		if (start > end || start >= totalSize || end >= totalSize) {
			return new Response(null, {
				status: 416,
				headers: {
					'Content-Range': `bytes */${totalSize}`,
					'Accept-Ranges': 'bytes'
				}
			});
		}

		const chunkSize = end - start + 1;
		const rangeStream = createReadStream(filePath, { start, end });
		const webStream = Readable.toWeb(rangeStream) as unknown as ReadableStream;

		return new Response(webStream, {
			status: 206,
			headers: {
				'Content-Type': mimeType,
				'Content-Length': String(chunkSize),
				'Content-Range': `bytes ${start}-${end}/${totalSize}`,
				'Content-Disposition': `inline; filename="${safeName}"`,
				'Accept-Ranges': 'bytes',
				'Cache-Control': 'private, max-age=86400'
			}
		});
	}

	// ── Full-file response (no Range header) ───────────────────────────────────
	const stream = createReadStream(filePath);
	const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
	return new Response(webStream, {
		headers: {
			'Content-Type': mimeType,
			'Content-Length': String(totalSize),
			'Content-Disposition': `inline; filename="${safeName}"`,
			'Accept-Ranges': 'bytes',
			'Cache-Control': 'private, max-age=86400'
		}
	});
};
