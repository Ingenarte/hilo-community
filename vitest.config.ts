import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

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
		globals: false
	},
	resolve: {
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname
		}
	}
});
