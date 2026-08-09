/**
 * Facade over the abstract `Storage` (see `storage.ts`).
 *
 * Existing call sites (`saveUploadedFile`, `uploadPath`) keep working
 * unchanged; the actual fs/S3/whatever lives behind `getStorage()`.
 *
 * MIME allow-list lives here because it's policy, not transport.
 */

import { getStorage, type StoredFile } from './storage';

const ALLOWED_PREFIXES = ['image/', 'application/', 'text/', 'video/', 'audio/'];

/**
 * Extension → MIME map used for server-side fallback inference.
 * Applied when the client delivers a file with an empty MIME string
 * (e.g. macOS drag-and-drop screenshots).
 *
 * SOURCE OF TRUTH: keep in sync with EXT_TO_MIME in src/lib/Composer.svelte.
 * SVG is intentionally excluded — it is an XSS vector when served inline.
 * Unknown extensions fall through to application/octet-stream (accepted by
 * the allow-list) so legitimate files are never silently blocked.
 */
const EXT_TO_MIME: Record<string, string> = {
	// Images
	png: 'image/png',
	jpg: 'image/jpeg', jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	heic: 'image/heic', heif: 'image/heif',
	bmp: 'image/bmp',
	avif: 'image/avif',
	// Video
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
	mkv: 'video/x-matroska',
	// Audio
	m4a: 'audio/mp4',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	// Documents
	pdf: 'application/pdf',
	txt: 'text/plain',
	md: 'text/markdown',
	csv: 'text/csv',
	json: 'application/json',
	zip: 'application/zip'
};

/**
 * Infer MIME type from a filename extension when the provided MIME is empty.
 * Returns the provided MIME unchanged if it is already non-empty.
 * Falls back to 'application/octet-stream' for unknown extensions.
 *
 * This is a defense-in-depth measure: the client normalizes MIME at ingestion
 * time, but older bundles or third-party tools may still send empty MIMEs.
 */
export function normalizeMimeForFile(filename: string, providedMime: string): string {
	if (providedMime) return providedMime;
	const dot = filename.lastIndexOf('.');
	if (dot < 0) return 'application/octet-stream';
	const ext = filename.slice(dot + 1).toLowerCase();
	return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export function isAllowedMime(mime: string): boolean {
	if (!mime) return false;
	if (mime === 'application/octet-stream') return true;
	return ALLOWED_PREFIXES.some((p) => mime.startsWith(p));
}

export async function saveUploadedFile(file: File): Promise<StoredFile> {
	return getStorage().save(file);
}

export function uploadPath(storedName: string): string {
	return getStorage().pathOf(storedName);
}
