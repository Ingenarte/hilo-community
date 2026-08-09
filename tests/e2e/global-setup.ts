/**
 * Playwright global setup for the a11y audit.
 *
 * Signs in once per role and persists session storage-state to disk.
 * Each describe block in a11y.spec.ts loads the appropriate state file,
 * so no repeated logins occur during the test run — avoiding rate-limiting.
 *
 * Output files (gitignored):
 *   tests/e2e/.auth/admin.json
 *   tests/e2e/.auth/user.json
 */

import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// All targets/credentials come from env — never hardcode real accounts here.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

const ADMIN_EMAIL = process.env.HILO_ADMIN_EMAIL ?? 'admin@local.test';
const ADMIN_PASS = process.env.ADMIN_FIXED_PASSWORD ?? 'admin-local-pw';

const USER_EMAIL = process.env.HILO_USER_EMAIL ?? 'user@local.test';
const USER_PASS = process.env.HILO_USER_PASSWORD ?? 'user-local-pw';

const AUTH_DIR = path.join(process.cwd(), 'tests/e2e/.auth');

async function saveAuth(email: string, password: string, outFile: string): Promise<void> {
	const browser = await chromium.launch();
	const context = await browser.newContext({ baseURL: BASE_URL });
	const page = await context.newPage();

	await page.goto('/login');
	await page.waitForLoadState('domcontentloaded');
	await page.locator('input#email').fill(email);
	await page.locator('input#fixed').fill(password);

	// Click submit and wait for navigation to /tickets.
	// Using Promise.all to capture the navigation that results from form action
	// redirect (303), which Playwright tracks as a frame navigation event.
	await Promise.all([
		page.waitForURL(/\/tickets/, { timeout: 30_000 }),
		page.locator('button[type="submit"]').click()
	]);

	await context.storageState({ path: outFile });
	console.log(`[global-setup] Saved auth state for ${email} → ${outFile}`);

	await browser.close();
}

async function globalSetup(): Promise<void> {
	fs.mkdirSync(AUTH_DIR, { recursive: true });

	await saveAuth(ADMIN_EMAIL, ADMIN_PASS, path.join(AUTH_DIR, 'admin.json'));
	await saveAuth(USER_EMAIL, USER_PASS, path.join(AUTH_DIR, 'user.json'));
}

export default globalSetup;
