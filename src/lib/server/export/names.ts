import type { AttachmentKind } from './types';

export function attachmentKind(mime: string): AttachmentKind {
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('audio/')) return 'audio';
	if (mime.startsWith('video/')) return 'video';
	return 'other';
}

/** Keep letters, digits, dot, dash and underscore; preserve a short extension. */
export function safeFileName(name: string, max = 80): string {
	const base = name.replace(/[/\\]/g, '_').trim() || 'file';
	const dot = base.lastIndexOf('.');
	const ext = dot > 0 ? base.slice(dot).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12) : '';
	const stem = (dot > 0 ? base.slice(0, dot) : base)
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, '_')
		.replace(/^[._]+|_+$/g, '')
		.slice(0, Math.max(1, max - ext.length));
	return `${stem || 'file'}${ext}`;
}

/** Unique, stable path for an attachment inside a ticket's ZIP folder. */
export function assetPathFor(index: number, att: { id: number; filename: string }): string {
	return `assets/${String(index).padStart(3, '0')}-${att.id}-${safeFileName(att.filename)}`;
}

export function isoDate(unix: number): string {
	return new Date(unix * 1000).toISOString();
}

export function exportStamp(d = new Date()): string {
	return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Characters outside WinAnsi (cp1252) cannot be drawn with the built-in PDF
// fonts. Map the common ones, drop the rest (emoji, CJK, control chars).
const WIN_ANSI_EXTRA = new Set(
	[...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((c) => c.codePointAt(0)!)
);
const REPLACEMENTS: Record<string, string> = {
	'→': '->',
	'←': '<-',
	'↩': '<-',
	'✓': 'v',
	'✔': 'v',
	'✗': 'x',
	'✘': 'x',
	' ': ' ',
	'\t': '    '
};

export function toWinAnsi(text: string): string {
	let out = '';
	for (const ch of text.normalize('NFC')) {
		const cp = ch.codePointAt(0)!;
		if (ch === '\n') out += ch;
		else if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
		else if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp))
			out += ch;
		// anything else is dropped
	}
	return out;
}

/** Remove characters that are illegal in XML 1.0 (they corrupt .docx files). */
export function xmlSafe(text: string): string {
	return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}
