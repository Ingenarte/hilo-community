/**
 * Playwright config for running e2e tests against local staging.
 *
 * Usage:
 *   pnpm stage:up && pnpm stage:seed
 *   pnpm test:e2e
 *
 * Does NOT start a web server — tests the local staging stack at
 * http://localhost:3001 (or override via PLAYWRIGHT_BASE_URL env var).
 * Credentials default to the local seed values; override via env vars.
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 60_000,
	workers: 1,
	fullyParallel: false,
	use: {
		baseURL: BASE_URL,
		viewport: { width: 1280, height: 800 },
		colorScheme: 'dark',
		locale: 'en-US',
		timezoneId: 'Europe/Madrid',
		// Spoof a stable private IP so repeated runs don't exhaust the
		// rate-limit bucket (10 login attempts / 5 min per IP).
		extraHTTPHeaders: { 'X-Forwarded-For': '10.0.0.88' }
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	outputDir: 'playwright/output',
	reporter: [['list']]
});
