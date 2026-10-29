import PDFDocument from 'pdfkit';
import { SLA_HOURS } from '../../sla';
import { fmtBytes } from '../utils';
import { isoDate, toWinAnsi } from './names';
import type { PreparedImage } from './images';
import type { ExportAttachment, ExportTicket } from './types';

export type PdfContext = {
	brand: string;
	generatedAt: number;
	/** Returns a prepared image for embedding, or null to list it instead. */
	openImage: (att: ExportAttachment) => Promise<PreparedImage | null>;
};

const GRAY = '#6b7280';
const RULE = '#d1d5db';
const RED = '#b91c1c';
const MAX_IMAGE_HEIGHT = 380;

/**
 * Renders tickets to a PDF using the built-in fonts (no font files to ship).
 * Text is reduced to WinAnsi; images are embedded; audio/video/other files are
 * listed (audio with its transcript). The returned document is a readable
 * stream that fills as the async work below progresses.
 */
export function renderPdf(tickets: ExportTicket[], ctx: PdfContext): PDFKit.PDFDocument {
	const doc = new PDFDocument({
		size: 'A4',
		margin: 50,
		info: { Title: tickets.length === 1 ? `Ticket #${tickets[0].id}` : 'Ticket export', Producer: ctx.brand }
	});

	const contentWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
	const bottom = () => doc.page.height - doc.page.margins.bottom;
	const ensureSpace = (h: number) => {
		if (doc.y + h > bottom()) doc.addPage();
	};
	const rule = () => {
		doc.moveDown(0.4);
		const y = doc.y;
		doc
			.strokeColor(RULE)
			.lineWidth(0.5)
			.moveTo(doc.page.margins.left, y)
			.lineTo(doc.page.width - doc.page.margins.right, y)
			.stroke();
		doc.moveDown(0.6);
	};

	async function run() {
		if (tickets.length > 1) {
			doc.font('Helvetica-Bold').fontSize(22).fillColor('#111827').text(toWinAnsi(`${ctx.brand} ticket export`));
			doc.moveDown(0.3);
			doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(
				`Generated ${isoDate(ctx.generatedAt)} - ${tickets.length} tickets`
			);
			doc.moveDown(1);
			doc.fillColor('#111827').fontSize(11);
			for (const t of tickets) {
				ensureSpace(18);
				doc.font('Helvetica-Bold').text(`#${t.id}`, { continued: true });
				doc.font('Helvetica').text(`  ${toWinAnsi(t.title)}  (${t.status}, ${t.priority})`);
			}
			doc.addPage();
		}

		for (let i = 0; i < tickets.length; i++) {
			if (i > 0) doc.addPage();
			await renderTicket(tickets[i]);
		}
		doc.end();
	}

	async function renderTicket(t: ExportTicket) {
		doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text(toWinAnsi(`#${t.id}  ${t.title}`), {
			width: contentWidth()
		});
		doc.moveDown(0.4);
		doc.font('Helvetica').fontSize(10).fillColor(GRAY);
		const meta: string[] = [
			`Owner: ${t.owner}`,
			`Status: ${t.status}`,
			`Priority: ${t.priority} (reply within ${SLA_HOURS[t.priority]}h)`
		];
		if (t.slaDueAt !== null) meta.push(`Target due: ${isoDate(t.slaDueAt)}`);
		if (t.projects.length) meta.push(`Projects: ${t.projects.join(', ')}`);
		meta.push(`Created: ${isoDate(t.createdAt)}`, `Last update: ${isoDate(t.updatedAt)}`);
		for (const line of meta) doc.text(toWinAnsi(line));
		if (t.priority === 'urgent' && t.priorityReason) {
			doc.fillColor(RED).text(toWinAnsi(`Urgent reason: ${t.priorityReason}`));
		}
		rule();

		for (const m of t.messages) {
			ensureSpace(60);
			const flags = [m.internal ? 'internal' : '', m.edited ? 'edited' : ''].filter(Boolean);
			doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(
				toWinAnsi(`${isoDate(m.created_at)} - ${m.who}${flags.length ? ` (${flags.join(', ')})` : ''}`),
				{ width: contentWidth() }
			);
			doc.moveDown(0.2);
			doc.font('Helvetica').fontSize(11).fillColor('#111827').text(toWinAnsi(m.body || '(empty body)'), {
				width: contentWidth()
			});

			for (const a of m.attachments) await renderAttachment(a);
			rule();
		}
	}

	async function renderAttachment(a: ExportAttachment) {
		doc.moveDown(0.3);
		if (a.kind === 'image' && !a.missing) {
			const img = await ctx.openImage(a);
			if (img) {
				const maxW = contentWidth();
				const scale = Math.min(1, maxW / img.width, MAX_IMAGE_HEIGHT / img.height);
				const w = img.width * scale;
				const h = img.height * scale;
				ensureSpace(h + 16);
				const y = doc.y;
				doc.image(img.data, doc.page.margins.left, y, { width: w, height: h });
				doc.y = y + h + 4;
				doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRAY).text(
					toWinAnsi(`${a.filename} - ${fmtBytes(a.size_bytes)}`),
					doc.page.margins.left,
					doc.y,
					{ width: contentWidth() }
				);
				return;
			}
		}
		doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(
			toWinAnsi(
				`Attachment: ${a.filename} - ${fmtBytes(a.size_bytes)} - ${a.mime_type}${
					a.missing ? ' (file not available)' : ''
				}`
			),
			doc.page.margins.left,
			doc.y,
			{ width: contentWidth() }
		);
		if (a.transcript_text) {
			doc.font('Helvetica-Oblique').fontSize(10).fillColor('#374151').text(
				toWinAnsi(`Transcript: ${a.transcript_text}`),
				doc.page.margins.left + 12,
				doc.y,
				{ width: contentWidth() - 12 }
			);
		}
	}

	run().catch((err) => doc.destroy(err instanceof Error ? err : new Error(String(err))));
	return doc;
}
