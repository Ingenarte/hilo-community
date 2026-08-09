/**
 * Storage interface — abstracts where attachments physically live.
 *
 * Today: local filesystem under `config.uploadDir`.
 * Tomorrow: S3, B2, GCS, R2 — implement a new adapter, swap at boot.
 *
 * The OCP/DIP discipline mirrors `mailer.ts`. Routes import `getStorage()`
 * and never touch `fs` directly. Tests inject `MemoryStorage`.
 */

import { mkdirSync, createWriteStream, statSync, createReadStream, unlinkSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Readable as NodeReadable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type StoredFile = {
	storedName: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
};

export interface Storage {
	save(file: File): Promise<StoredFile>;
	readStream(storedName: string): Readable;
	pathOf(storedName: string): string;
	remove(storedName: string): void;
}

function safeFilename(name: string): string {
	const base = name.replace(/[/\\]/g, '_').trim();
	return base.slice(0, 200) || 'file';
}

/** Local-filesystem storage. The current production default. */
export class LocalFsStorage implements Storage {
	constructor(private readonly dir: string) {
		mkdirSync(resolve(dir), { recursive: true });
	}

	async save(file: File): Promise<StoredFile> {
		const ext = extname(file.name).toLowerCase().slice(0, 10);
		const storedName = `${Date.now().toString(36)}-${randomBytes(10).toString('hex')}${ext}`;
		const fullPath = join(resolve(this.dir), storedName);

		// Stream the upload directly into the file. The previous version
		// read `await file.arrayBuffer()` into a Node Buffer, which kept
		// the entire payload resident in RAM. On a 3.8 GB VM shared with
		// other containers, two concurrent 100 MB uploads were a quarter
		// of available memory just for one queue step. Streaming keeps
		// the resident set close to the highWaterMark (~64 KB) regardless
		// of file size.
		const sink = createWriteStream(fullPath);
		try {
			await pipeline(NodeReadable.fromWeb(file.stream() as never), sink);
		} catch (err) {
			// Clean up the partial file so retries don't leave orphans.
			try {
				unlinkSync(fullPath);
			} catch {
				/* ignore */
			}
			throw err;
		}

		const stat = statSync(fullPath);
		return {
			storedName,
			filename: safeFilename(file.name),
			mimeType: file.type || 'application/octet-stream',
			sizeBytes: stat.size
		};
	}

	readStream(storedName: string): Readable {
		return createReadStream(this.pathOf(storedName));
	}

	pathOf(storedName: string): string {
		return join(resolve(this.dir), storedName);
	}

	remove(storedName: string): void {
		try {
			unlinkSync(this.pathOf(storedName));
		} catch {
			// Already gone or never existed; idempotent delete.
		}
	}
}

/** In-memory storage for tests. Files live in a Map keyed by stored name. */
export class MemoryStorage implements Storage {
	private files = new Map<string, { content: Buffer; meta: StoredFile }>();

	async save(file: File): Promise<StoredFile> {
		const storedName = `${Date.now().toString(36)}-${randomBytes(10).toString('hex')}`;
		const buffer = Buffer.from(await file.arrayBuffer());
		const meta: StoredFile = {
			storedName,
			filename: safeFilename(file.name),
			mimeType: file.type || 'application/octet-stream',
			sizeBytes: buffer.length
		};
		this.files.set(storedName, { content: buffer, meta });
		return meta;
	}

	readStream(storedName: string): Readable {
		const entry = this.files.get(storedName);
		if (!entry) throw new Error(`MemoryStorage: ${storedName} not found`);
		const { Readable } = require('node:stream') as typeof import('node:stream');
		return Readable.from(entry.content);
	}

	pathOf(storedName: string): string {
		return `memory://${storedName}`;
	}

	remove(storedName: string): void {
		this.files.delete(storedName);
	}
}

let current: Storage | null = null;

export function setStorage(s: Storage): void {
	current = s;
}

export function getStorage(): Storage {
	if (!current) {
		throw new Error('Storage not initialised. Call setStorage() at boot.');
	}
	return current;
}
