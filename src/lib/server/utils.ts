/**
 * Shared utilities (KISS, DRY): centralised formatters and constants used by
 * server-side modules. Kept dependency-free so it can be imported anywhere.
 */

export function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function truncate(s: string, n = 280): string {
	const clean = s.replace(/\s+/g, ' ').trim();
	return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

export function iconForMime(mime: string): string {
	if (mime.startsWith('image/')) return '🖼️';
	if (mime.startsWith('video/')) return '🎬';
	if (mime.startsWith('audio/')) return '🎵';
	if (mime === 'application/pdf') return '📕';
	if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) return '🗜️';
	if (mime.startsWith('text/')) return '📄';
	if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
	if (mime.includes('presentation') || mime.includes('powerpoint')) return '📈';
	if (mime.includes('word') || mime.includes('document')) return '📝';
	return '📎';
}

export const PROD = process.env.NODE_ENV === 'production';
