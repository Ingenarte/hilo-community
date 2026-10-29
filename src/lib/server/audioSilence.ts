import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { db } from './db';
import { log } from './logger';
import { broadcast } from './sse';
import { uploadPath } from './uploads';

/**
 * Flags voice recordings that contain no sound at all (a muted or wrongly
 * selected microphone records digital silence, about -91 dB). The chat then
 * tells the listener the recording is empty instead of leaving a player that
 * seems broken. Needs ffmpeg; without it the flag simply stays unknown.
 */

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
/** Loudest sample at or below this is treated as no sound. Speech peaks above -30 dB. */
export const SILENT_MAX_DB = -70;

export function isAudioMime(mime: string | null | undefined): boolean {
	return (mime ?? '').toLowerCase().startsWith('audio/');
}

/** Loudest sample in dB (0 = full scale), or null when it cannot be measured. */
export function measureMaxVolumeDb(path: string): Promise<number | null> {
	return new Promise((resolve) => {
		let stderr = '';
		const child = spawn(
			FFMPEG,
			['-nostdin', '-hide_banner', '-protocol_whitelist', 'file', '-i', path, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
			{ stdio: ['ignore', 'ignore', 'pipe'] }
		);
		const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
		child.stderr.on('data', (d: Buffer) => {
			if (stderr.length < 200_000) stderr += d.toString();
		});
		child.on('error', () => {
			clearTimeout(timer);
			resolve(null);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (code !== 0) return resolve(null);
			const m = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr);
			if (!m) return resolve(null);
			resolve(m[1] === '-inf' ? -200 : Number(m[1]));
		});
	});
}

export function classifySilence(maxDb: number | null): 0 | 1 | null {
	if (maxDb === null || Number.isNaN(maxDb)) return null;
	return maxDb <= SILENT_MAX_DB ? 1 : 0;
}

let chain: Promise<unknown> = Promise.resolve();

/** Measure one audio attachment and store `silent` (1 empty, 0 has sound). One at a time. */
export function checkAttachmentSilence(attachmentId: number, storedName: string): Promise<void> {
	chain = chain.then(async () => {
		try {
			const path = uploadPath(storedName);
			if (!existsSync(path)) return;
			const flag = classifySilence(await measureMaxVolumeDb(path));
			if (flag === null) return;
			db.prepare('UPDATE attachments SET silent = ? WHERE id = ?').run(flag, attachmentId);
			if (flag === 1) {
				log.info('silent voice recording detected', { attachment_id: attachmentId });
				// The measurement finishes after the message was already pushed to open
				// tabs, so tell them to refresh and show the "no sound" note.
				const row = db
					.prepare('SELECT m.ticket_id AS ticket_id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = ?')
					.get(attachmentId) as { ticket_id: number } | undefined;
				if (row) broadcast(row.ticket_id, 'attachment', { id: attachmentId });
			}
		} catch (err) {
			log.warn('silence check failed', { err: err instanceof Error ? err.message : String(err) });
		}
	});
	return chain as Promise<void>;
}

/** Fire-and-forget right after upload. */
export function checkSilenceInBackground(attachmentId: number, storedName: string, mime: string): void {
	if (!isAudioMime(mime)) return;
	void checkAttachmentSilence(attachmentId, storedName);
}

/** Boot-time pass over audio attachments that have never been measured. */
export function backfillSilenceFlags(limit = 500): void {
	const rows = db
		.prepare(`SELECT id, stored_name FROM attachments WHERE silent IS NULL AND mime_type LIKE 'audio/%' ORDER BY id DESC LIMIT ?`)
		.all(limit) as Array<{ id: number; stored_name: string }>;
	for (const r of rows) void checkAttachmentSilence(r.id, r.stored_name);
}
