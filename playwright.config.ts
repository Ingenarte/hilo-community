import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for screenshots + demo GIF.
 *
 * - testDir: `tests/e2e` so the unit tests under `tests/` keep running on
 *   vitest without colliding with Playwright's runner.
 * - One worker, sequential. The dev server boots in `webServer` if not
 *   already running.
 * - Viewport tuned for nice screenshots (1280×800).
 */
export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 120_000,
	workers: 1,
	fullyParallel: false,
	use: {
		baseURL: 'http://localhost:5180',
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: 2,
		colorScheme: 'dark',
		locale: 'en-US',
		timezoneId: 'Europe/Madrid',
		// Spoof a stable private IP so every test run gets a fresh rate-limit
		// bucket. Without this, repeated runs against localhost exhaust the
		// 10-attempt/5-min login window for 127.0.0.1.
		extraHTTPHeaders: { 'X-Forwarded-For': '10.0.0.99' }
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: 'pnpm dev',
		port: 5180,
		reuseExistingServer: true,
		timeout: 60_000,
		stdout: 'ignore',
		stderr: 'pipe'
	},
	outputDir: 'playwright/output',
	reporter: [['list']]
});
