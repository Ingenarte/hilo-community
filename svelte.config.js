import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ out: 'build' }),
		csrf: {
			// CSRF only guards POST/PUT/DELETE form actions. The earlier
			// `['*']` (disabled) was set for magic-link emails, but magic
			// links are GET — CSRF does not apply. Restrict to the real
			// origins so cross-site forms cannot trigger state changes.
			// The public origin comes from PUBLIC_BASE_URL at build time
			// (Docker passes it as a build arg; see Dockerfile). Localhost
			// origins keep dev and staging working without it.
			trustedOrigins: [
				...(process.env.PUBLIC_BASE_URL?.startsWith('http')
					? [process.env.PUBLIC_BASE_URL.replace(/\/$/, '')]
					: []),
				'http://localhost:5180', // pnpm dev
				'http://localhost:3001' // pnpm stage:up
			]
		}
	}
};

export default config;
