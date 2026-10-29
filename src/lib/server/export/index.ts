import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { config } from '../env';
import { getStorage } from '../storage';
import { exportStamp } from './names';
import { renderDocx } from './docx';
import { prepareImage } from './images';
import { renderIndexMarkdown, renderTicketMarkdown } from './markdown';
import { renderPdf } from './pdf';
import { zipGenerator, type ZipEntry } from './zip';
import type { ExportAttachment, ExportFormat, ExportTicket } from './types';

export const MAX_EXPORT_TICKETS = 50;
export const MAX_EXPORT_BYTES = 1024 * 1024 * 1024; // 1 GiB of attachments per ZIP

const DISPOSITION = (name: string) => `attachment; filename="${name}"`;

function baseName(tickets: ExportTicket[]): string {
	return tickets.length === 1
		? `hilo-ticket-${tickets[0].id}`
		: `hilo-tickets-${tickets.length}-${exportStamp()}`;
}

function toWeb(stream: Readable): ReadableStream<Uint8Array> {
	return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

function openImageFor(att: ExportAttachment) {
	return prepareImage(getStorage().pathOf(att.stored_name), att.mime_type);
}

function hasFiles(tickets: ExportTicket[]): boolean {
	return tickets.some((t) => t.messages.some((m) => m.attachments.some((a) => !a.missing)));
}

function zipEntries(tickets: ExportTicket[]): ZipEntry[] {
	const encoder = new TextEncoder();
	const single = tickets.length === 1;
	const entries: ZipEntry[] = [];
	if (!single) {
		entries.push({ name: 'index.md', data: encoder.encode(renderIndexMarkdown(tickets, Math.floor(Date.now() / 1000))) });
	}
	for (const t of tickets) {
		const dir = single ? '' : `ticket-${t.id}/`;
		entries.push({ name: `${dir}ticket.md`, data: encoder.encode(renderTicketMarkdown(t, { withAssets: true })) });
		for (const m of t.messages) {
			for (const a of m.attachments) {
				if (a.missing) continue;
				entries.push({
					name: `${dir}${a.assetPath}`,
					store: true,
					open: () => getStorage().readStream(a.stored_name)
				});
			}
		}
	}
	return entries;
}

export async function buildExportResponse(
	tickets: ExportTicket[],
	format: ExportFormat
): Promise<Response> {
	const name = baseName(tickets);
	const now = Math.floor(Date.now() / 1000);

	if (format === 'md') {
		if (tickets.length === 1 && !hasFiles(tickets)) {
			const body = renderTicketMarkdown(tickets[0], { withAssets: false });
			return new Response(body, {
				headers: {
					'Content-Type': 'text/markdown; charset=utf-8',
					'Content-Disposition': DISPOSITION(`${name}.md`),
					'Content-Length': String(Buffer.byteLength(body, 'utf8'))
				}
			});
		}
		const total = tickets.reduce(
			(sum, t) =>
				sum + t.messages.reduce((s, m) => s + m.attachments.reduce((x, a) => x + (a.missing ? 0 : a.size_bytes), 0), 0),
			0
		);
		if (total > MAX_EXPORT_BYTES) {
			throw error(413, 'These tickets have too many attachments to export together. Select fewer tickets.');
		}
		return new Response(toWeb(Readable.from(zipGenerator(zipEntries(tickets)))), {
			headers: { 'Content-Type': 'application/zip', 'Content-Disposition': DISPOSITION(`${name}.zip`) }
		});
	}

	if (format === 'pdf') {
		const doc = renderPdf(tickets, { brand: config.brand, generatedAt: now, openImage: openImageFor });
		return new Response(toWeb(doc as unknown as Readable), {
			headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': DISPOSITION(`${name}.pdf`) }
		});
	}

	const buf = await renderDocx(tickets, { brand: config.brand, generatedAt: now, openImage: openImageFor });
	return new Response(new Uint8Array(buf), {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'Content-Disposition': DISPOSITION(`${name}.docx`),
			'Content-Length': String(buf.length)
		}
	});
}
