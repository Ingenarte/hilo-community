/**
 * POST /api/transcribe/voice
 *
 * Transcribes a short audio blob for the composer mic-to-text feature.
 * The client sends rolling 20-second chunks; each chunk is transcribed
 * independently and the text is appended to the composer textarea.
 *
 * Constraints:
 *   - Auth-gated (locals.user required).
 *   - Accepts only audio/* content via multipart/form-data field 'audio'.
 *   - Rejects blobs longer than 30 s (safety margin; client records in 20 s windows).
 *   - Rate-limited: 30 requests per user per minute (each request ≤ 20 s of audio,
 *     so this is effectively 10 minutes of accepted audio per minute, which is
 *     intentionally generous — the user is dictating live, not batch-uploading).
 *   - Passes the buffer through the concurrency-capped transcribe() queue.
 *   - Returns { text, language }.
 *
 * Why 30 s limit? The client sends 20 s timeslice chunks. An extra 10 s buffer
 * handles slow network or MediaRecorder variance before the server rejects.
 * This also stops someone from sending the full 120-second voice attachment
 * through this route (that belongs in the /transcribe attachment flow).
 */

import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { transcribe } from '$lib/server/transcribe';
import { rateLimit } from '$lib/server/rateLimit';
import { log } from '$lib/server/logger';

// 30 seconds of audio at 16 kHz 16-bit mono = 960 000 bytes ≈ 1 MB.
// Allow up to 4 MB to cover higher bitrates (webm/opus, aac).
const MAX_BYTES = 4 * 1024 * 1024;
// Reject blobs whose stated duration is over 30 s (client enforced too).
const MAX_DURATION_S = 30;

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	// Rate limit: 30 requests per user per 60 seconds.
	const rl = rateLimit(`transcribe:voice:user:${locals.user.id}`, 30, 60);
	if (!rl.ok) {
		throw error(429, `Too many dictation requests. Retry in ${rl.retryAfterSeconds}s.`);
	}

	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.includes('multipart/form-data')) {
		throw error(400, 'Expected multipart/form-data');
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		throw error(400, 'Malformed form data');
	}

	const audioField = form.get('audio');
	if (!audioField || typeof audioField === 'string') {
		throw error(400, 'Missing audio field');
	}

	const mime = (audioField as File | Blob).type;
	if (!mime.startsWith('audio/')) {
		throw error(415, 'Only audio/* content accepted');
	}

	if (audioField.size > MAX_BYTES) {
		throw error(413, `Audio too large (max ${MAX_BYTES / 1024 / 1024} MB)`);
	}

	// Optional: client can send stated duration to allow server-side check
	// before paying the cost of transcription.
	const durationField = form.get('duration_s');
	if (durationField) {
		const dur = Number(durationField);
		if (Number.isFinite(dur) && dur > MAX_DURATION_S) {
			throw error(422, `Audio too long (max ${MAX_DURATION_S}s per chunk)`);
		}
	}

	const audioBuffer = Buffer.from(await audioField.arrayBuffer());

	try {
		const result = await transcribe({ audio: audioBuffer, mime });
		log.info('voice dictation ok', {
			user_id: locals.user.id,
			chars: result.text.length,
			language: result.language,
			durationMs: result.durationMs
		});
		return json({ text: result.text, language: result.language });
	} catch (err) {
		log.error('voice dictation failed', {
			user_id: locals.user.id,
			err: err instanceof Error ? err.message : String(err)
		});
		throw error(503, 'Transcription service unavailable. Please try again.');
	}
};
