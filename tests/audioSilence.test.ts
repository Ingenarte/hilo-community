import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifySilence, isAudioMime, measureMaxVolumeDb, SILENT_MAX_DB } from '../src/lib/server/audioSilence';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('classifySilence', () => {
	it('flags digital silence and keeps real speech levels', () => {
		expect(classifySilence(-91)).toBe(1);
		expect(classifySilence(-200)).toBe(1);
		expect(classifySilence(SILENT_MAX_DB)).toBe(1);
		expect(classifySilence(-69.9)).toBe(0);
		expect(classifySilence(-30)).toBe(0);
		expect(classifySilence(-0.6)).toBe(0);
	});
	it('stays unknown when it could not be measured', () => {
		expect(classifySilence(null)).toBeNull();
		expect(classifySilence(Number.NaN)).toBeNull();
	});
	it('recognises audio mime types only', () => {
		expect(isAudioMime('audio/webm;codecs=opus')).toBe(true);
		expect(isAudioMime('AUDIO/MP4')).toBe(true);
		expect(isAudioMime('video/mp4')).toBe(false);
		expect(isAudioMime(null)).toBe(false);
	});
});

describe.skipIf(!hasFfmpeg)('measureMaxVolumeDb (needs ffmpeg)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'hilo-silence-'));
	const make = (name: string, src: string, codec: string[]) => {
		const out = join(dir, name);
		const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', src, ...codec, out]);
		expect(r.status).toBe(0);
		return out;
	};

	it('measures an Opus recording of pure silence as silent', async () => {
		const f = make('silence.webm', 'anullsrc=r=48000:cl=mono:d=3', ['-c:a', 'libopus']);
		const db = await measureMaxVolumeDb(f);
		expect(db).not.toBeNull();
		expect(classifySilence(db)).toBe(1);
	});
	it('measures a tone as having sound', async () => {
		const f = make('tone.webm', 'sine=frequency=440:duration=2', ['-c:a', 'libopus']);
		expect(classifySilence(await measureMaxVolumeDb(f))).toBe(0);
	});
	it('returns null for a file that is not audio', async () => {
		const { writeFileSync } = await import('node:fs');
		const f = join(dir, 'junk.webm');
		writeFileSync(f, Buffer.from('not audio '.repeat(50)));
		expect(await measureMaxVolumeDb(f)).toBeNull();
	});
});
