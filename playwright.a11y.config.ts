/**
 * Playwright config for the accessibility audit (axe-core).
 * Targets the production server — no local webServer needed.
 * Usage: npx playwright test --config playwright.a11y.config.ts
 *
 * Global setup signs in once per role and saves storage state to
 * tests/e2e/.auth/{admin,user}.json — avoiding repeated logins
 * that would trigger the production rate limiter (10 attempts / 5 min).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/a11y.spec.ts',
	timeout: 60_000,
	workers: 1,
	fullyParallel: false,
	globalSetup: './tests/e2e/global-setup.ts',
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001',
		viewport: { width: 1280, height: 800 },
		locale: 'en-US',
		timezoneId: 'Europe/Madrid',
		ignoreHTTPSErrors: false
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	// No webServer — production is already running.
	outputDir: 'playwright/a11y-output',
	reporter: [['list'], ['json', { outputFile: 'playwright/a11y-output/results.json' }]]
});
