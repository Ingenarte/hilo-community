/**
 * Client-side chunked upload facade using tus-js-client (MIT).
 *
 * Design decisions:
 *   - Files ≤ 95 MB use the existing single-shot multipart send path.
 *   - Files > 95 MB go through the tus.io resumable upload pipeline:
 *       1. POST /api/uploads/init → get an upload session id
 *       2. tus.Upload with uploadUrl = /api/uploads/<id>
 *          sends sequential 80 MB PATCH requests
 *       3. POST /api/uploads/<id>/complete → assembles the file and
 *          returns { stored_name } for the Composer to include in Send
 *
 * Resume support: tus-js-client stores the upload URL + offset in
 * localStorage via the default fingerprint mechanism. If the same File
 * object is seen again (same name + size + lastModified), it resumes
 * from the last server offset rather than restarting.
 *
 * The `UploadHandle` is the live reference the Composer binds to for
 * progress reporting, pause/resume, and abort.
 */

import * as tus from 'tus-js-client';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Files at or below this size use the direct multipart send path. */
export const SINGLE_SHOT_LIMIT_BYTES = 95 * 1024 * 1024;

/** Chunk size in bytes. Must match the server-side constant (80 MB). */
const CHUNK_SIZE_BYTES = 80 * 1024 * 1024;

/**
 * Retry back-off delays (ms) per tus.io recommendation.
 * Sequence: 0 s, 1 s, 3 s, 5 s — 4 attempts before giving up.
 */
const RETRY_DELAYS = [0, 1_000, 3_000, 5_000];

// ─── Types ───────────────────────────────────────────────────────────────────

export type UploadStatus =
	| 'queued'
	| 'uploading'
	| 'paused'
	| 'completing'
	| 'done'
	| 'error'
	| 'aborted';

export type UploadHandle = {
	/** Upload session id (from POST /api/uploads/init). */
	id: string;
	/** The File being uploaded. */
	file: File;
	/** Bytes confirmed received by the server. */
	bytesUploaded: number;
	/** Total file size in bytes. */
	bytesTotal: number;
	/** Current status. */
	status: UploadStatus;
	/**
	 * Populated after POST /complete succeeds.
	 * This is the stored_name (not an attachment_id — the attachment row
	 * is created when the user sends the message with this upload_id).
	 */
	storedName?: string;
	/** Human-readable error message when status === 'error'. */
	errorMsg?: string;
	/** Pause the upload (can be resumed later). */
	pause(): void;
	/** Resume a paused upload. */
	resume(): void;
	/** Abort and delete the server session. */
	abort(): void;
	/**
	 * Restart a failed upload from scratch by creating a new tus.Upload
	 * that resumes from the server-acknowledged offset. Safe to call only
	 * when status === 'error'. Resets errorMsg and status to 'uploading'.
	 */
	retry(): void;
};

// ─── API ─────────────────────────────────────────────────────────────────────

/** True if this file must use the chunked path (above the single-shot limit). */
export function shouldUseChunked(file: File): boolean {
	return file.size > SINGLE_SHOT_LIMIT_BYTES;
}

export type StartChunkedUploadArgs = {
	file: File;
	ticketId: number;
	onProgress(handle: UploadHandle): void;
	onComplete(handle: UploadHandle): void;
	onError(handle: UploadHandle): void;
};

/**
 * Start a chunked upload for `file`.
 *
 * Returns a handle immediately; the upload starts in the background.
 * The caller must call `onProgress`, `onComplete`, and `onError` to
 * react to state changes.
 */
export function startChunkedUpload(args: StartChunkedUploadArgs): UploadHandle {
	const { file, ticketId, onProgress, onComplete, onError } = args;

	// The handle is mutated in-place as the upload progresses so the caller
	// can hold a stable reference.
	const handle: UploadHandle = {
		id: '', // filled after init succeeds
		file,
		bytesUploaded: 0,
		bytesTotal: file.size,
		status: 'queued',
		pause: () => {
			/* overridden after init */
		},
		resume: () => {
			/* overridden after init */
		},
		abort: () => {
			/* overridden after init */
		},
		retry: () => {
			/* overridden after init */
		}
	};

	// Kick off asynchronously so the caller always gets the handle first.
	void (async () => {
		// ── Step 1: mint an upload session ────────────────────────────────────
		let initData: { upload_id: string; chunk_size: number };
		try {
			const resp = await fetch('/api/uploads/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ticket_id: ticketId,
					filename: file.name,
					mime_type: file.type || 'application/octet-stream',
					size: file.size
				})
			});
			if (!resp.ok) {
				const { error } = (await resp.json().catch(() => ({ error: resp.statusText }))) as {
					error: string;
				};
				throw new Error(error || `Server error ${resp.status}`);
			}
			initData = (await resp.json()) as { upload_id: string; chunk_size: number };
		} catch (err) {
			handle.status = 'error';
			handle.errorMsg = (err as Error).message;
			onError(handle);
			return;
		}

		handle.id = initData.upload_id;
		handle.status = 'uploading';
		onProgress(handle);

		// ── Step 2: stream chunks via tus-js-client ───────────────────────────
		// We point tus at the pre-existing session URL (uploadUrl) so it skips
		// the tus creation step and goes straight to PATCH.
		const uploadUrl = `/api/uploads/${handle.id}`;

		/**
		 * Build a tus.Upload options object for this session. Extracted so both
		 * the initial upload and retry() can share the same callback set.
		 */
		function makeTusOptions(tusUploadRef: { current: tus.Upload | null }): tus.UploadOptions {
			return {
				uploadUrl,
				chunkSize: CHUNK_SIZE_BYTES,
				retryDelays: RETRY_DELAYS,
				// Note: tus-js-client automatically adds "Tus-Resumable: 1.0.0" on
			// every request (openRequest() in upload.js line ~989). Adding it here
			// as well would produce a duplicate "1.0.0, 1.0.0" value that fails the
			// server's exact-match check. Leave headers empty — the protocol header
			// is managed by the library.
			headers: {},
				onProgress(bytesSent, bytesTotal) {
					handle.bytesUploaded = bytesSent;
					handle.bytesTotal = bytesTotal;
					handle.status = 'uploading';
					onProgress(handle);
				},
				onSuccess() {
					// tus declared the PATCH sequence complete.
					// Call /complete to assemble the file and get the stored_name.
					void (async () => {
						handle.status = 'completing';
						onProgress(handle);
						try {
							const completeResp = await fetch(`/api/uploads/${handle.id}/complete`, {
								method: 'POST'
							});
							if (!completeResp.ok) {
								const { error } = (await completeResp
									.json()
									.catch(() => ({ error: completeResp.statusText }))) as { error: string };
								throw new Error(error || `Complete failed ${completeResp.status}`);
							}
							const data = (await completeResp.json()) as {
								stored_name: string;
								size_bytes: number;
							};
							handle.storedName = data.stored_name;
							handle.bytesUploaded = handle.bytesTotal;
							handle.status = 'done';
							onComplete(handle);
						} catch (err) {
							handle.status = 'error';
							handle.errorMsg = (err as Error).message;
							onError(handle);
						}
					})();
				},
				onError(err) {
					// tus-js-client exhausted all retries.
					if (handle.status === 'aborted') return; // user-initiated, not an error
					handle.status = 'error';
					handle.errorMsg = err.message;
					onError(handle);
				},
				onChunkComplete(_chunkSize, bytesAccepted, bytesTotal) {
					handle.bytesUploaded = bytesAccepted;
					handle.bytesTotal = bytesTotal;
				}
			};
		}

		// Mutable ref so retry() can swap the live instance.
		const tusRef: { current: tus.Upload | null } = { current: null };
		const tusUpload = new tus.Upload(file, makeTusOptions(tusRef));
		tusRef.current = tusUpload;

		// Wire pause / resume / abort / retry to the live tus instance.
		handle.pause = () => {
			tusRef.current?.abort(false); // false = do not DELETE the session
			handle.status = 'paused';
			onProgress(handle);
		};
		handle.resume = () => {
			handle.status = 'uploading';
			tusRef.current?.start();
			onProgress(handle);
		};
		handle.abort = async () => {
			handle.status = 'aborted';
			await tusRef.current?.abort(false);
			// Best-effort server-side cleanup.
			if (handle.id) {
				fetch(`/api/uploads/${handle.id}`, { method: 'DELETE' }).catch(() => {
					/* ignore */
				});
			}
		};
		handle.retry = () => {
			// Create a fresh tus.Upload reusing the existing uploadUrl so it
			// resumes from the server-acknowledged offset (via HEAD). This is safe
			// after the original instance exhausted its retries.
			if (handle.status !== 'error') return;
			handle.status = 'uploading';
			handle.errorMsg = undefined;
			onProgress(handle);
			const fresh = new tus.Upload(file, makeTusOptions(tusRef));
			tusRef.current = fresh;
			fresh.start();
		};

		tusUpload.start();
	})();

	return handle;
}
