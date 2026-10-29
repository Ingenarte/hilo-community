import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests run against a throwaway SQLite file, never the developer's ./data/hilo.db.
// Set at config-evaluation time so it also beats the value in the committed .env.
const testDir = mkdtempSync(join(tmpdir(), 'hilo-vitest-'));
process.env.DATABASE_PATH = join(testDir, 'hilo.db');
process.env.UPLOAD_DIR = join(testDir, 'uploads');

// We need the SvelteKit plugin here (not just in vite.config.ts) so the
// SvelteKit virtual modules — `$env/dynamic/private`, `$env/static/public`,
// `$app/*` — resolve when imported by source files under test.
// Tests that touch `src/lib/server/env.ts` (which imports `$env/dynamic/private`)
// were failing on `tests/rateLimit.test.ts` because the plain vitest resolver
// can't find those virtual modules without the plugin.
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		globals: false,
		// All files share one throwaway SQLite file, so run them one at a time.
		fileParallelism: false
	},
	resolve: {
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname
		}
	}
});
