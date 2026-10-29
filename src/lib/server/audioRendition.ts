import { execFile } from 'node:child_process';
import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { needsRendition } from '../audioFormats';
import { log } from './logger';
import { uploadPath } from './uploads';

/**
 * Voice messages recorded by Chrome, Edge, Firefox and Android are
 * WebM/Opus (or Ogg/Opus), which Safari on iPhone often cannot play. For
 * those we keep the original and also build an AAC-in-MP4 (m4a) rendition,
 * which every browser plays. The rendition lives next to the original as
 * `<stored_name>.m4a`, is created right after upload (and lazily on first
 * request for older files) and is removed together with the attachment.
 */

export const RENDITION_SUFFIX = '.m4a';
export const RENDITION_MIME = 'audio/mp4';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const TIMEOUT_MS = 60_000;

export { needsRendition };

export function renditionName(storedName: string): string {
	return storedName + RENDITION_SUFFIX;
}

let ffmpegMissing = false;
/** Files that failed to convert: do not retry on every page view for a while. */
const FAILED_RETRY_MS = 10 * 60 * 1000;
const failedAt = new Map<string, number>();
const inflight = new Map<string, Promise<string | null>>();
let chain: Promise<unknown> = Promise.resolve();

function run(src: string, tmp: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(
			FFMPEG,
			[
				'-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
				'-protocol_whitelist', 'file',
				'-i', src,
				'-vn', '-map_metadata', '-1',
				'-t', '1800',
				'-c:a', 'aac', '-b:a', '64k',
				'-movflags', '+faststart',
				'-f', 'mp4', tmp
			],
			{ timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
			(err) => {
				if (err) {
					if ((err as NodeJS.ErrnoException).code === 'ENOENT') ffmpegMissing = true;
					log.warn('audio rendition failed', {
						err: err.message.slice(0, 300),
						ffmpeg_missing: ffmpegMissing
					});
					resolve(false);
				} else resolve(true);
			}
		);
	});
}

/**
 * Returns the path of the AAC rendition, creating it if needed, or null when
 * it cannot be made (ffmpeg missing, corrupt audio). Concurrent callers for
 * the same file share one conversion, and conversions run one at a time.
 */
export function ensureRendition(storedName: string): Promise<string | null> {
	const dest = uploadPath(renditionName(storedName));
	if (existsSync(dest)) return Promise.resolve(dest);
	if (ffmpegMissing) return Promise.resolve(null);
	const failed = failedAt.get(storedName);
	if (failed && Date.now() - failed < FAILED_RETRY_MS) return Promise.resolve(null);
	const existing = inflight.get(storedName);
	if (existing) return existing;

	const src = uploadPath(storedName);
	const job = (chain = chain.then(async () => {
		if (existsSync(dest)) return dest;
		if (!existsSync(src)) return null;
		const tmp = `${dest}.tmp-${process.pid}`;
		const ok = await run(src, tmp);
		if (!ok) {
			failedAt.set(storedName, Date.now());
			try { unlinkSync(tmp); } catch { /* nothing to clean */ }
			return null;
		}
		try {
			if (statSync(tmp).size === 0) throw new Error('empty output');
			renameSync(tmp, dest);
			return dest;
		} catch (err) {
			failedAt.set(storedName, Date.now());
			log.warn('audio rendition output unusable', { err: String(err) });
			try { unlinkSync(tmp); } catch { /* nothing to clean */ }
			return null;
		}
	}) as Promise<string | null>).finally(() => inflight.delete(storedName));
	inflight.set(storedName, job);
	return job;
}

/** Fire-and-forget conversion right after upload so the first play is instant. */
export function prepareRenditionInBackground(storedName: string, mime: string): void {
	if (!needsRendition(mime)) return;
	ensureRendition(storedName).catch(() => undefined);
}

export function removeRendition(storedName: string): void {
	try {
		unlinkSync(uploadPath(renditionName(storedName)));
	} catch {
		// never created or already gone
	}
}
