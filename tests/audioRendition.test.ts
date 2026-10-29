import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { needsRendition } from '../src/lib/audioFormats';
import { ensureRendition, renditionName, removeRendition } from '../src/lib/server/audioRendition';
import { uploadPath } from '../src/lib/server/uploads';
import { config } from '../src/lib/server/env';
import { LocalFsStorage, setStorage } from '../src/lib/server/storage';

// The app wires storage in hooks.server.ts; tests do it themselves.
setStorage(new LocalFsStorage(config.uploadDir));

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('needsRendition', () => {
	it('covers Opus containers and ignores formats that already play everywhere', () => {
		for (const m of ['audio/webm', 'audio/webm;codecs=opus', 'AUDIO/WEBM; codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/opus']) {
			expect(needsRendition(m)).toBe(true);
		}
		for (const m of ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'video/mp4', 'video/webm', 'image/png', '', null, undefined]) {
			expect(needsRendition(m as string)).toBe(false);
		}
	});
	it('puts the rendition next to the original', () => {
		expect(renditionName('abc123.webm')).toBe('abc123.webm.m4a');
	});
});

describe.skipIf(!hasFfmpeg)('ensureRendition (needs ffmpeg)', () => {
	it('builds an AAC m4a from a WebM/Opus file, once, and reuses it', async () => {
		mkdirSync(resolve(config.uploadDir), { recursive: true });
		const stored = `test-voice-${Date.now()}.webm`;
		const src = uploadPath(stored);
		const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', src]);
		expect(made.status).toBe(0);

		const [a, b] = await Promise.all([ensureRendition(stored), ensureRendition(stored)]);
		expect(a).toBe(b);
		expect(a).toBe(uploadPath(renditionName(stored)));
		expect(existsSync(a as string)).toBe(true);
		expect(statSync(a as string).size).toBeGreaterThan(500);

		const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', a as string]);
		expect(probe.stdout.toString().trim()).toBe('aac');
		expect(await ensureRendition(stored)).toBe(a);

		removeRendition(stored);
		expect(existsSync(a as string)).toBe(false);
	});

	it('returns null for a missing original instead of throwing', async () => {
		expect(await ensureRendition('does-not-exist.webm')).toBeNull();
	});

	it('does not retry a corrupt file on every request', async () => {
		const { writeFileSync } = await import('node:fs');
		mkdirSync(resolve(config.uploadDir), { recursive: true });
		const stored = `test-corrupt-${Date.now()}.webm`;
		writeFileSync(uploadPath(stored), Buffer.from('this is not audio at all'.repeat(40)));
		expect(await ensureRendition(stored)).toBeNull();
		// Second call answers from the failure cache, without spawning ffmpeg.
		const t0 = Date.now();
		expect(await ensureRendition(stored)).toBeNull();
		expect(Date.now() - t0).toBeLessThan(20);
		expect(existsSync(uploadPath(renditionName(stored)))).toBe(false);
	});
});
