import { SLA_HOURS } from '../../sla';
import { fmtBytes } from '../utils';
import { isoDate } from './names';
import type { ExportAttachment, ExportTicket } from './types';

function linkText(s: string): string {
	return s.replace(/[[\]]/g, '_');
}

function transcriptBlock(a: ExportAttachment): string[] {
	if (!a.transcript_text) return [];
	const lang = a.transcript_lang && a.transcript_lang !== 'auto' ? ` (${a.transcript_lang})` : '';
	return [
		'',
		`_Transcript${lang}:_`,
		'',
		...a.transcript_text.split('\n').map((l) => `> ${l}`)
	];
}

function attachmentLines(a: ExportAttachment, withAssets: boolean): string[] {
	const meta = `${fmtBytes(a.size_bytes)} · ${a.mime_type}`;
	if (!withAssets || a.missing) {
		const note = a.missing && withAssets ? ' · _(file not available)_' : '';
		return [`- ${a.filename} · ${meta}${note}`, ...transcriptBlock(a).map((l) => (l ? `  ${l}` : l))];
	}
	if (a.kind === 'image') {
		return ['', `![${linkText(a.filename)}](${a.assetPath})`, '', `_${a.filename} · ${meta}_`];
	}
	if (a.kind === 'audio') {
		return [`- [${linkText(a.filename)}](${a.assetPath}) · ${meta}`, ...transcriptBlock(a)];
	}
	return [`- [${linkText(a.filename)}](${a.assetPath}) · ${meta}`];
}

/**
 * Markdown for one ticket. With `withAssets`, attachments link to the files the
 * ZIP carries under `assets/`; without it they are only listed.
 */
export function renderTicketMarkdown(
	t: ExportTicket,
	opts: { withAssets: boolean; now?: number } = { withAssets: false }
): string {
	const md: string[] = [];
	md.push(`# Ticket #${t.id} · ${t.title}`);
	md.push('');
	md.push(`- **Owner**: ${t.owner}`);
	md.push(`- **Status**: ${t.status}`);
	md.push(`- **Priority**: ${t.priority} (reply within ${SLA_HOURS[t.priority]}h)`);
	if (t.slaDueAt !== null) md.push(`- **Target due**: ${isoDate(t.slaDueAt)}`);
	if (t.priority === 'urgent' && t.priorityReason) md.push(`- **Urgent reason**: ${t.priorityReason}`);
	if (t.projects.length) md.push(`- **Projects**: ${t.projects.join(', ')}`);
	md.push(`- **Created**: ${isoDate(t.createdAt)}`);
	md.push(`- **Last update**: ${isoDate(t.updatedAt)}`);
	md.push('');
	md.push('---');
	md.push('');

	for (const m of t.messages) {
		const flags: string[] = [];
		if (m.internal) flags.push('internal');
		if (m.edited) flags.push('edited');
		const flagStr = flags.length ? ` _(${flags.join(', ')})_` : '';
		md.push(`### ${isoDate(m.created_at)} · ${m.who}${flagStr}`);
		md.push('');
		md.push(m.body || '_(empty body)_');
		if (m.attachments.length) {
			md.push('');
			md.push('**Attachments**:');
			for (const a of m.attachments) md.push(...attachmentLines(a, opts.withAssets));
		}
		md.push('');
		md.push('---');
		md.push('');
	}
	return md.join('\n');
}

export function renderIndexMarkdown(tickets: ExportTicket[], generatedAt: number): string {
	const md = [
		'# Hilo ticket export',
		'',
		`Generated ${isoDate(generatedAt)} · ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`,
		''
	];
	for (const t of tickets) {
		md.push(
			`- [#${t.id} · ${linkText(t.title)}](ticket-${t.id}/ticket.md) · ${t.status} · ${t.priority}`
		);
	}
	md.push('');
	return md.join('\n');
}
