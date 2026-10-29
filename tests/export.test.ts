import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { assetPathFor, attachmentKind, safeFileName, toWinAnsi, xmlSafe } from '../src/lib/server/export/names';
import { renderIndexMarkdown, renderTicketMarkdown } from '../src/lib/server/export/markdown';
import { zipGenerator } from '../src/lib/server/export/zip';
import { renderPdf } from '../src/lib/server/export/pdf';
import { renderDocx } from '../src/lib/server/export/docx';
import type { ExportTicket } from '../src/lib/server/export/types';

function ticket(over: Partial<ExportTicket> = {}): ExportTicket {
	return {
		id: 7,
		title: 'Checkout fails on Safari',
		owner: 'owner@example.com',
		status: 'open',
		priority: 'urgent',
		priorityReason: 'Customers cannot pay',
		slaDueAt: 1_700_086_400,
		createdAt: 1_700_000_000,
		updatedAt: 1_700_000_500,
		projects: ['Shop'],
		messages: [
			{
				id: 1,
				created_at: 1_700_000_000,
				who: 'owner@example.com',
				internal: false,
				edited: false,
				body: 'See the screenshot: acentos, ñ and "quotes" 🔥',
				attachments: [
					{ id: 11, filename: 'Screen shot (1).png', mime_type: 'image/png', size_bytes: 2048, stored_name: 'a', kind: 'image', transcript_text: null, transcript_lang: null, assetPath: assetPathFor(1, { id: 11, filename: 'Screen shot (1).png' }), missing: false },
					{ id: 12, filename: 'voice.ogg', mime_type: 'audio/ogg', size_bytes: 4096, stored_name: 'b', kind: 'audio', transcript_text: 'Hello there\nsecond line', transcript_lang: 'en', assetPath: assetPathFor(2, { id: 12, filename: 'voice.ogg' }), missing: false }
				]
			},
			{
				id: 2,
				created_at: 1_700_000_100,
				who: 'Admin',
				internal: true,
				edited: true,
				body: 'Internal note',
				attachments: []
			}
		],
		...over
	};
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
	const parts: Buffer[] = [];
	for await (const c of stream) parts.push(Buffer.from(c));
	return Buffer.concat(parts);
}

describe('export names', () => {
	it('classifies attachments', () => {
		expect(attachmentKind('image/png')).toBe('image');
		expect(attachmentKind('audio/ogg')).toBe('audio');
		expect(attachmentKind('video/mp4')).toBe('video');
		expect(attachmentKind('application/pdf')).toBe('other');
	});

	it('makes safe, unique asset paths', () => {
		expect(safeFileName('Screen shot (1).png')).toBe('Screen_shot_1.png');
		expect(safeFileName('../../etc/passwd')).not.toContain('/');
		expect(safeFileName('año.JPG')).toBe('ano.JPG');
		expect(safeFileName('')).toBe('file');
		expect(assetPathFor(3, { id: 9, filename: 'a b.png' })).toBe('assets/003-9-a_b.png');
	});

	it('reduces text to what the built-in PDF fonts can draw', () => {
		expect(toWinAnsi('ñ á “quote” — ok')).toBe('ñ á “quote” — ok');
		expect(toWinAnsi('fire 🔥 done')).toBe('fire  done');
		expect(toWinAnsi('a → b')).toBe('a -> b');
	});

	it('strips characters that corrupt XML', () => {
		expect(xmlSafe('a\u0000b\u0008c\nd')).toBe('abc\nd');
	});
});

describe('markdown', () => {
	it('links images and audio to assets and quotes transcripts', () => {
		const md = renderTicketMarkdown(ticket(), { withAssets: true });
		expect(md).toContain('# Ticket #7 · Checkout fails on Safari');
		expect(md).toContain('- **Priority**: urgent (reply within 24h)');
		expect(md).toContain('- **Urgent reason**: Customers cannot pay');
		expect(md).toContain('![Screen shot (1).png](assets/001-11-Screen_shot_1.png)');
		expect(md).toContain('[voice.ogg](assets/002-12-voice.ogg)');
		expect(md).toContain('> Hello there');
		expect(md).toContain('> second line');
		expect(md).toContain('_(internal, edited)_');
	});

	it('only lists attachments when assets are not carried', () => {
		const md = renderTicketMarkdown(ticket(), { withAssets: false });
		expect(md).not.toContain('![');
		expect(md).toContain('- Screen shot (1).png · 2.0 KB · image/png');
	});

	it('notes files that are no longer available', () => {
		const t = ticket();
		t.messages[0].attachments[0].missing = true;
		expect(renderTicketMarkdown(t, { withAssets: true })).toContain('(file not available)');
	});

	it('builds an index for bulk exports', () => {
		const idx = renderIndexMarkdown([ticket(), ticket({ id: 8, title: 'Other' })], 1_700_000_000);
		expect(idx).toContain('[#7 · Checkout fails on Safari](ticket-7/ticket.md)');
		expect(idx).toContain('2 tickets');
	});
});

describe('zipGenerator', () => {
	it('produces a valid archive from buffers and streamed files', async () => {
		const big = randomBytes(3 * 1024 * 1024 + 17);
		const encoder = new TextEncoder();
		const zip = await collect(
			zipGenerator([
				{ name: 'ticket.md', data: encoder.encode('# hello é') },
				{
					name: 'assets/big.bin',
					store: true,
					open: async function* () {
						for (let i = 0; i < big.length; i += 65536) yield big.subarray(i, i + 65536);
					}
				}
			])
		);
		const files = unzipSync(new Uint8Array(zip));
		expect(Object.keys(files).sort()).toEqual(['assets/big.bin', 'ticket.md']);
		expect(strFromU8(files['ticket.md'])).toBe('# hello é');
		expect(Buffer.from(files['assets/big.bin']).equals(big)).toBe(true);
	});
});

async function tinyJpeg() {
	const data = await sharp({ create: { width: 80, height: 50, channels: 3, background: '#cc0000' } }).jpeg().toBuffer();
	return { data, type: 'jpg' as const, width: 80, height: 50 };
}

describe('pdf', () => {
	it('renders a valid PDF with the image embedded', async () => {
		const img = await tinyJpeg();
		const doc = renderPdf([ticket(), ticket({ id: 8, title: 'Second' })], {
			brand: 'Hilo',
			generatedAt: 1_700_000_000,
			openImage: async (a) => (a.kind === 'image' ? img : null)
		});
		const buf = await collect(doc as unknown as AsyncIterable<Uint8Array>);
		const text = buf.toString('latin1');
		expect(text.startsWith('%PDF-')).toBe(true);
		expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
		expect(text).toContain('/Subtype /Image');
		expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
	});
});

describe('docx', () => {
	it('renders a valid docx with the image embedded', async () => {
		const img = await tinyJpeg();
		const buf = await renderDocx([ticket()], {
			brand: 'Hilo',
			generatedAt: 1_700_000_000,
			openImage: async (a) => (a.kind === 'image' ? img : null)
		});
		const files = unzipSync(new Uint8Array(buf));
		const doc = strFromU8(files['word/document.xml']);
		expect(doc).toContain('Checkout fails on Safari');
		expect(doc).toContain('Customers cannot pay');
		expect(doc).toContain('Transcript: Hello there');
		expect(Object.keys(files).some((f) => f.startsWith('word/media/'))).toBe(true);
	});
});
