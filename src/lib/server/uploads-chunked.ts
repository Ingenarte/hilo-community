/**
 * Server-side tus.io 1.0.0 resumable-upload subset.
 *
 * Implements the minimal set of operations required by the tus protocol:
 *   - createUploadSession  → POST /api/uploads/init
 *   - getUploadSession     → HEAD  /api/uploads/[id]
 *   - appendChunk          → PATCH /api/uploads/[id]
 *   - completeUploadSession→ POST  /api/uploads/[id]/complete
 *   - abortUploadSession   → DELETE /api/uploads/[id]
 *   - pruneExpiredSessions → daily cleanup job
 *
 * Design choices:
 *   - Chunks are streamed directly to the .part file with `pipeline()` so
 *     RAM stays bounded at the highWaterMark (~64 KB) regardless of chunk
 *     size. `await request.arrayBuffer()` is intentionally avoided.
 *   - Concurrency safety: the PATCH writes an atomic SQLite UPDATE where
 *     `received_bytes` must exactly equal the expected offset before it
 *     increments. A mismatched concurrent PATCH is rejected with 409.
 *   - Session expiry: 24 h window gives plenty of resume time. The
 *     cleanup job marks stale sessions expired and deletes partial files.
 */

import { openSync, closeSync, fsyncSync, createWriteStream, unlinkSync, renameSync, mkdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { db } from './db';
import type { DBUploadSession } from './db';
import { config } from './env';
import { isAllowedMime } from './uploads';
import { log } from './logger';

// ─── Per-upload in-process lock ───────────────────────────────────────────────

/**
 * Serialise concurrent async operations on the same upload id.
 *
 * Two concurrent PATCH requests for the same id both pass the offset
 * validation if they both read `received_bytes` before either updates it.
 * This lock ensures only one operation runs at a time per id, so the
 * second PATCH sees the updated offset and is rejected with 409.
 *
 * The map holds a "tail" promise per id. Each caller chains onto the tail
 * (`.then(fn, fn)` so the chain continues even if `fn` throws), then
 * atomically replaces the tail. The `finally` removes the entry once the
 * chain settles — preventing unbounded map growth.
 */
const uploadLocks = new Map<string, Promise<unknown>>();

async function withUploadLock<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
	const prev = uploadLocks.get(uploadId) ?? Promise.resolve();
	let resolve!: (v: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const ticket = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	const next = prev.then(
		() => fn().then(resolve, reject),
		() => fn().then(resolve, reject)
	);
	uploadLocks.set(
		uploadId,
		next.finally(() => {
			if (uploadLocks.get(uploadId) === next) uploadLocks.delete(uploadId);
		})
	);
	return ticket;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum allowed single-upload size (bytes). */
export const MAX_UPLOAD_BYTES = (config.maxUploadMb || 500) * 1_000_000;

/** Session TTL in seconds (24 hours). */
const SESSION_TTL_SECONDS = 86_400;

/** Directory that holds in-progress .part files. */
function partDir(): string {
	const d = join(resolve(config.uploadDir), '.parts');
	mkdirSync(d, { recursive: true });
	return d;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a URL-safe random identifier (32 chars). */
function makeId(): string {
	return randomBytes(24).toString('base64url').slice(0, 32);
}

// ─── Session management ───────────────────────────────────────────────────────

export type CreateSessionArgs = {
	userId: number;
	ticketId: number;
	filename: string;
	mimeType: string;
	totalBytes: number;
};

export type CreateSessionResult = {
	id: string;
	partialPath: string;
};

/**
 * Create a new upload session. Validates size and MIME type.
 * Touches the partial file so it exists at size 0 immediately.
 *
 * Throws with a `status` property (number) for HTTP error responses.
 */
export function createUploadSession(args: CreateSessionArgs): CreateSessionResult {
	const { userId, ticketId, filename, mimeType, totalBytes } = args;

	if (totalBytes <= 0) {
		throw Object.assign(new Error('File size must be greater than 0.'), { status: 400 });
	}
	if (totalBytes > MAX_UPLOAD_BYTES) {
		const limitMb = Math.round(MAX_UPLOAD_BYTES / 1_000_000);
		throw Object.assign(new Error(`File exceeds the ${limitMb} MB limit.`), { status: 413 });
	}
	if (!isAllowedMime(mimeType)) {
		throw Object.assign(new Error(`MIME type ${mimeType} is not allowed.`), { status: 415 });
	}

	const id = makeId();
	const ext = extname(filename).toLowerCase().slice(0, 10);
	const partialPath = join(partDir(), `${id}${ext}.part`);

	// Touch the file so it exists with 0 bytes before we return the ID.
	const fd = openSync(partialPath, 'w');
	closeSync(fd);

	const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

	db.prepare(
		`INSERT INTO upload_sessions
		   (id, user_id, ticket_id, filename, mime_type, total_bytes, received_bytes,
		    partial_path, status, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'open', ?)`
	).run(id, userId, ticketId, filename, mimeType, totalBytes, partialPath, expiresAt);

	return { id, partialPath };
}

/** Return the upload session row, or null if it does not exist. */
export function getUploadSession(id: string): DBUploadSession | null {
	return (
		(db
			.prepare('SELECT * FROM upload_sessions WHERE id = ?')
			.get(id) as DBUploadSession | undefined) ?? null
	);
}

// ─── Chunk ingestion ─────────────────────────────────────────────────────────

export type AppendChunkArgs = {
	id: string;
	offset: number;
	stream: Readable;
};

export type AppendChunkResult = {
	newOffset: number;
};

/**
 * Stream one chunk into the partial file and advance `received_bytes`.
 *
 * Invariants enforced:
 *   - Session must exist, be open, and not expired.
 *   - `offset` must exactly match `received_bytes` (tus requirement).
 *
 * Uses `pipeline()` for backpressure-aware streaming; RAM usage is bounded
 * by the stream's highWaterMark, not the chunk size.
 *
 * The entire body runs inside `withUploadLock` so two concurrent PATCH
 * requests for the same upload id cannot both pass the offset validation.
 * The second request will see the updated `received_bytes` and be rejected
 * with 409.
 */
export async function appendChunk(args: AppendChunkArgs): Promise<AppendChunkResult> {
	const { id, offset, stream } = args;
	return withUploadLock(id, async () => {
		const session = getUploadSession(id);
		if (!session) {
			throw Object.assign(new Error('Upload session not found.'), { status: 404 });
		}
		if (session.status !== 'open') {
			throw Object.assign(new Error(`Session is ${session.status}.`), { status: 409 });
		}
		if (Math.floor(Date.now() / 1000) > session.expires_at) {
			throw Object.assign(new Error('Upload session has expired.'), { status: 410 });
		}
		if (offset !== session.received_bytes) {
			throw Object.assign(
				new Error(
					`Upload-Offset mismatch: expected ${session.received_bytes}, got ${offset}.`
				),
				{ status: 409 }
			);
		}

		// Stream chunk bytes into the partial file in append mode.
		const writer = createWriteStream(session.partial_path, { flags: 'a' });
		let bytesWritten = 0;
		stream.on('data', (chunk: Buffer) => {
			bytesWritten += chunk.length;
		});
		await pipeline(stream, writer);

		// Flush the OS page cache to disk before updating the DB counter.
		// Without this, a crash between pipeline() and the UPDATE leaves
		// received_bytes advanced while the bytes are not yet durable —
		// a resume would restart from the wrong offset (finding M4).
		const fd = openSync(session.partial_path, 'a');
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}

		// Atomic increment: only update if received_bytes still matches the
		// offset we validated above. Rejects any concurrent PATCH on the same
		// session that slipped through (very unlikely but safe).
		const result = db
			.prepare(
				`UPDATE upload_sessions
				 SET received_bytes = received_bytes + ?
				 WHERE id = ? AND received_bytes = ? AND status = 'open'`
			)
			.run(bytesWritten, id, offset);

		if (result.changes === 0) {
			// Another concurrent PATCH won the race. The chunk has already been
			// written to disk — this is a data integrity violation. Log it.
			log.warn('appendChunk: concurrent PATCH race detected', { id, offset, bytesWritten });
			throw Object.assign(new Error('Concurrent write conflict.'), { status: 409 });
		}

		return { newOffset: offset + bytesWritten };
	});
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export type CompleteSessionResult = {
	storedName: string;
	sizeBytes: number;
};

/**
 * Finalise a completed upload:
 *   1. Validate received_bytes === total_bytes.
 *   2. Mark status 'assembling' BEFORE rename (crash-safe — if rename never
 *      happens, startup recovery detects the partial_path is not a storedName
 *      and marks the row 'aborted').
 *   3. Rename the .part file to its permanent path in the uploads dir.
 *   4. Mark the row 'complete' and store the storedName in partial_path.
 *
 * The caller is responsible for inserting the `attachments` row.
 */
export function completeUploadSession(id: string): CompleteSessionResult {
	const session = getUploadSession(id);
	if (!session) {
		throw Object.assign(new Error('Upload session not found.'), { status: 404 });
	}
	if (session.status !== 'open') {
		throw Object.assign(new Error(`Session is already ${session.status}.`), { status: 409 });
	}
	if (session.received_bytes !== session.total_bytes) {
		throw Object.assign(
			new Error(
				`Incomplete upload: received ${session.received_bytes} of ${session.total_bytes} bytes.`
			),
			{ status: 409 }
		);
	}

	// Build the final stored name with the same convention as LocalFsStorage.
	const ext = extname(session.filename).toLowerCase().slice(0, 10);
	const storedName = `${Date.now().toString(36)}-${randomBytes(10).toString('hex')}${ext}`;
	const finalPath = join(resolve(config.uploadDir), storedName);

	// Step 1: mark 'assembling' before rename so crash recovery can detect
	// a rename that never completed.
	db.prepare(
		`UPDATE upload_sessions SET status = 'assembling' WHERE id = ?`
	).run(id);

	// Step 2: rename the partial file to the final location.
	// Throws if rename fails — status stays 'assembling' so startup recovery
	// can attempt to complete or abort.
	renameSync(session.partial_path, finalPath);

	// Step 3: mark 'complete' and store the final storedName in partial_path.
	// The message handler reads this field when upload_session_ids is supplied.
	db.prepare(
		`UPDATE upload_sessions SET status = 'complete', partial_path = ? WHERE id = ?`
	).run(storedName, id);

	log.info('upload session complete', {
		id,
		storedName,
		sizeBytes: session.total_bytes
	});

	return { storedName, sizeBytes: session.total_bytes };
}

// ─── Abort ───────────────────────────────────────────────────────────────────

/**
 * Abort an in-progress session: mark it aborted and delete the partial file.
 * Idempotent — safe to call on already-aborted sessions.
 */
export function abortUploadSession(id: string): void {
	const session = getUploadSession(id);
	if (!session) return; // Already gone.

	db.prepare(
		`UPDATE upload_sessions SET status = 'aborted' WHERE id = ? AND status = 'open'`
	).run(id);

	try {
		unlinkSync(session.partial_path);
	} catch {
		// File may already be missing; ignore.
	}

	log.info('upload session aborted', { id });
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Mark timed-out sessions expired and delete their partial files.
 * Called from the daily cleanup job (`src/lib/server/cleanup.ts`).
 *
 * Returns the number of sessions pruned.
 */
export function pruneExpiredSessions(): number {
	const stale = db
		.prepare(
			`SELECT id, partial_path FROM upload_sessions
			 WHERE status = 'open' AND expires_at < unixepoch()`
		)
		.all() as Array<{ id: string; partial_path: string }>;

	if (stale.length === 0) return 0;

	const ids = stale.map((s) => s.id);
	const placeholders = ids.map(() => '?').join(',');
	db.prepare(
		`UPDATE upload_sessions SET status = 'expired' WHERE id IN (${placeholders})`
	).run(...ids);

	for (const s of stale) {
		try {
			unlinkSync(s.partial_path);
		} catch {
			// Already gone; ignore.
		}
	}

	log.info('pruneExpiredSessions', { pruned: stale.length });
	return stale.length;
}

// ─── SHA-256 helper (used in tests + verification scripts) ────────────────────

/**
 * Compute the SHA-256 hex digest of a file on disk.
 * Used by the E2E verification script to assert upload integrity.
 */
export function sha256OfFile(path: string): string {
	const { createReadStream } = require('node:fs') as typeof import('node:fs');
	const { createHash: _hash } = require('node:crypto') as typeof import('node:crypto');
	const hash = _hash('sha256');
	const stream = createReadStream(path);
	// Synchronous iteration via for...of is unavailable for streams here;
	// this function is only used in tests and scripts, not in the request path.
	// We use a synchronous read approach for simplicity.
	const { readFileSync } = require('node:fs') as typeof import('node:fs');
	hash.update(readFileSync(path));
	return hash.digest('hex');
}
