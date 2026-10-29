import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { SLA_HOURS } from '../../sla';
import { fmtBytes } from '../utils';
import { isoDate, xmlSafe } from './names';
import type { PreparedImage } from './images';
import type { ExportAttachment, ExportTicket } from './types';

export type DocxContext = {
	brand: string;
	generatedAt: number;
	openImage: (att: ExportAttachment) => Promise<PreparedImage | null>;
};

const MAX_W = 600; // px, fits an A4 page with default margins
const MAX_H = 720;

function bodyLines(text: string): Paragraph[] {
	return xmlSafe(text || '(empty body)')
		.split('\n')
		.map((line) => new Paragraph({ children: [new TextRun(line)] }));
}

function note(text: string, opts: { italics?: boolean; color?: string; size?: number } = {}): Paragraph {
	return new Paragraph({
		children: [
			new TextRun({
				text: xmlSafe(text),
				italics: opts.italics,
				color: opts.color ?? '6B7280',
				size: opts.size ?? 20
			})
		]
	});
}

async function ticketParagraphs(
	t: ExportTicket,
	ctx: DocxContext,
	pageBreakBefore: boolean
): Promise<Paragraph[]> {
	const out: Paragraph[] = [
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			pageBreakBefore,
			children: [new TextRun(xmlSafe(`#${t.id}  ${t.title}`))]
		}),
		note(`Owner: ${t.owner}`),
		note(`Status: ${t.status}`),
		note(`Priority: ${t.priority} (reply within ${SLA_HOURS[t.priority]}h)`)
	];
	if (t.slaDueAt !== null) out.push(note(`Target due: ${isoDate(t.slaDueAt)}`));
	if (t.priority === 'urgent' && t.priorityReason) {
		out.push(note(`Urgent reason: ${t.priorityReason}`, { color: 'B91C1C' }));
	}
	if (t.projects.length) out.push(note(`Projects: ${t.projects.join(', ')}`));
	out.push(note(`Created: ${isoDate(t.createdAt)}`), note(`Last update: ${isoDate(t.updatedAt)}`));

	for (const m of t.messages) {
		const flags = [m.internal ? 'internal' : '', m.edited ? 'edited' : ''].filter(Boolean);
		out.push(
			new Paragraph({
				spacing: { before: 240 },
				children: [
					new TextRun({
						text: xmlSafe(`${isoDate(m.created_at)} - ${m.who}${flags.length ? ` (${flags.join(', ')})` : ''}`),
						bold: true
					})
				]
			}),
			...bodyLines(m.body)
		);

		for (const a of m.attachments) {
			const img = a.kind === 'image' && !a.missing ? await ctx.openImage(a) : null;
			if (img) {
				const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
				out.push(
					new Paragraph({
						spacing: { before: 120 },
						children: [
							new ImageRun({
								type: img.type,
								data: img.data,
								transformation: {
									width: Math.max(1, Math.round(img.width * scale)),
									height: Math.max(1, Math.round(img.height * scale))
								},
								altText: {
									title: xmlSafe(a.filename),
									description: xmlSafe(a.filename),
									name: xmlSafe(a.filename)
								}
							})
						]
					}),
					note(`${a.filename} - ${fmtBytes(a.size_bytes)}`, { italics: true, size: 16 })
				);
			} else {
				out.push(
					note(
						`Attachment: ${a.filename} - ${fmtBytes(a.size_bytes)} - ${a.mime_type}${
							a.missing ? ' (file not available)' : ''
						}`
					)
				);
				if (a.transcript_text) {
					out.push(note(`Transcript: ${a.transcript_text}`, { italics: true, color: '374151' }));
				}
			}
		}
	}
	return out;
}

/** Builds a .docx with images embedded; other attachments are listed. */
export async function renderDocx(tickets: ExportTicket[], ctx: DocxContext): Promise<Buffer> {
	const children: Paragraph[] = [];

	if (tickets.length > 1) {
		children.push(
			new Paragraph({
				heading: HeadingLevel.TITLE,
				children: [new TextRun(xmlSafe(`${ctx.brand} ticket export`))]
			}),
			note(`Generated ${isoDate(ctx.generatedAt)} - ${tickets.length} tickets`)
		);
		for (const t of tickets) {
			children.push(
				new Paragraph({
					children: [new TextRun(xmlSafe(`#${t.id}  ${t.title}  (${t.status}, ${t.priority})`))]
				})
			);
		}
	}

	for (let i = 0; i < tickets.length; i++) {
		children.push(...(await ticketParagraphs(tickets[i], ctx, i > 0 || tickets.length > 1)));
	}

	const doc = new Document({
		creator: ctx.brand,
		title: tickets.length === 1 ? `Ticket #${tickets[0].id}` : 'Ticket export',
		sections: [{ children }]
	});
	return Packer.toBuffer(doc);
}
