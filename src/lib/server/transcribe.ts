/**
 * Thin client for the faster-whisper HTTP sidecar.
 *
 * - Concurrency-capped: at most `config.whisperMaxConcurrent` calls run at
 *   once; extras queue and run FIFO.
 * - On error, logs via the structured logger and rethrows so callers can
 *   surface a retry prompt.
 * - No external dependencies — uses the global fetch available in Node 18+.
 *
 * The sidecar exposes POST /v1/audio/transcriptions which mirrors the
 * OpenAI Whisper API shape. The model name must be passed explicitly as
 * a form field; the server ignores it and uses whatever model it loaded
 * at startup, but the field is required by the endpoint schema.
 */

import { config } from './env';
import { log } from './logger';

export type TranscribeArgs = {
	audio: Buffer;
	mime: string;
	/** BCP-47 language code e.g. 'es', 'en'. Omit for auto-detect. */
	language?: string;
};

export type TranscribeResult = {
	text: string;
	language: string;
	/** Wall-clock ms from POST to result (includes network round-trip). */
	durationMs: number;
};

// ── concurrency gate ─────────────────────────────────────────────────────────

let inFlight = 0;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
	return new Promise<void>((resolve) => {
		if (inFlight < config.whisperMaxConcurrent) {
			inFlight++;
			resolve();
		} else {
			queue.push(() => {
				inFlight++;
				resolve();
			});
		}
	});
}

function releaseSlot(): void {
	inFlight--;
	const next = queue.shift();
	if (next) next();
}

// ── transcription call ────────────────────────────────────────────────────────

export async function transcribe(args: TranscribeArgs): Promise<TranscribeResult> {
	await acquireSlot();
	const start = Date.now();
	try {
		const form = new FormData();
		// Blob constructor requires an ArrayBuffer, not a Node.js Buffer.
		const arrayBuf = args.audio.buffer.slice(
			args.audio.byteOffset,
			args.audio.byteOffset + args.audio.byteLength
		) as ArrayBuffer;
		form.append('file', new Blob([arrayBuf], { type: args.mime }), 'audio');
		form.append('model', config.whisperModel);
		if (args.language) form.append('language', args.language);

		const r = await fetch(`${config.whisperUrl}/v1/audio/transcriptions`, {
			method: 'POST',
			body: form
		});

		if (!r.ok) {
			const body = await r.text().catch(() => '');
			throw new Error(`whisper sidecar responded ${r.status}: ${body.slice(0, 200)}`);
		}

		const j = (await r.json()) as { text?: string; language?: string };
		const text = (j.text ?? '').trim();
		const language = j.language ?? 'auto';
		const durationMs = Date.now() - start;

		log.info('transcribe ok', { chars: text.length, language, durationMs });
		return { text, language, durationMs };
	} catch (err) {
		log.error('transcribe failed', {
			err: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start
		});
		throw err;
	} finally {
		releaseSlot();
	}
}

/**
 * Returns the current queue depth (waiting + running). Useful for the
 * /api/metrics endpoint (Phase 5.3).
 */
export function transcribeQueueDepth(): number {
	return inFlight + queue.length;
}
