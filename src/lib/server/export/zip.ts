import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

export type ZipEntry = {
	name: string;
	/** Already-compressed content (images, audio, video, archives): store as is. */
	store?: boolean;
	data?: Uint8Array;
	open?: () => AsyncIterable<Uint8Array>;
};

/**
 * Streams a ZIP archive. Each yield hands a chunk to the consumer, so memory
 * stays bounded by one read chunk even when the archive holds hundreds of MB.
 */
export async function* zipGenerator(entries: ZipEntry[]): AsyncGenerator<Uint8Array> {
	const queue: Uint8Array[] = [];
	let failure: Error | null = null;
	const zip = new Zip((err, chunk) => {
		if (err) failure = err;
		else queue.push(chunk);
	});
	function* flush() {
		while (queue.length) yield queue.shift()!;
	}

	for (const e of entries) {
		const file = e.store ? new ZipPassThrough(e.name) : new ZipDeflate(e.name, { level: 6 });
		zip.add(file);
		if (e.data) {
			file.push(e.data, true);
			yield* flush();
		} else if (e.open) {
			for await (const chunk of e.open()) {
				file.push(new Uint8Array(chunk), false);
				yield* flush();
			}
			file.push(new Uint8Array(0), true);
			yield* flush();
		} else {
			file.push(new Uint8Array(0), true);
			yield* flush();
		}
		if (failure) throw failure;
	}
	zip.end();
	yield* flush();
	if (failure) throw failure;
}
