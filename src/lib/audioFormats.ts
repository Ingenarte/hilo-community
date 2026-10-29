// Client-safe audio format rules (shared with the server rendition code).

/**
 * Original formats that also get an AAC (m4a) rendition. Opus in WebM/Ogg,
 * what Chrome, Edge, Firefox and Android record, is not reliably playable in
 * Safari on iPhone. MP4/M4A, MP3 and WAV already play everywhere.
 */
export function needsRendition(mime: string | null | undefined): boolean {
	const base = (mime ?? '').toLowerCase().split(';')[0].trim();
	return base === 'audio/webm' || base === 'audio/ogg' || base === 'audio/opus';
}
