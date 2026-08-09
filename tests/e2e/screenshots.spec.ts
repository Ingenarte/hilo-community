import { test, expect } from '@playwright/test';
import { createTicket, setTheme, signIn } from './_helpers';

/**
 * Captures the marketing-ready screenshots into `docs/screenshots/`.
 *
 * Run with:  pnpm screenshots
 *
 * Strategy: log in as the admin (so we exercise the admin UI), seed a
 * couple of tickets if the inbox is empty, then capture each view in both
 * dark and light themes. Filenames are stable so README / OG cards can
 * reference them.
 */

const SHOT_DIR = 'docs/screenshots';
const ADMIN_EMAIL = process.env.HILO_ADMIN_EMAIL || 'admin@local.test';
const USER_EMAIL = 'alice@example.com';

async function captureView(
	page: import('@playwright/test').Page,
	name: string,
	theme: 'dark' | 'light'
) {
	await setTheme(page, theme);
	await page.waitForTimeout(400); // let the theme transition settle
	// Use the banner landmark (top-level <header>) to avoid strict-mode errors
	// on pages that contain secondary <header> elements (e.g. ticket detail).
	await expect(page.getByRole('banner')).toBeVisible();
	await page.screenshot({
		path: `${SHOT_DIR}/${name}-${theme}.png`,
		fullPage: false,
		animations: 'disabled'
	});
}

test.describe('Hilo screenshots', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000); // allow up to 3 min — creates 3 tickets sequentially
		// Seed: ensure at least 3 tickets exist so the inbox isn't empty.
		// Use a spoofed X-Forwarded-For header so this seeding context gets
		// its own rate-limit bucket and doesn't share the 10-attempt/5-min
		// window with the individual test contexts.
		// Use a distinct IP from the test contexts (10.0.0.99) so seeding
		// doesn't share the rate-limit bucket with the screenshots tests.
		const ctx = await browser.newContext({
			extraHTTPHeaders: { 'X-Forwarded-For': '10.0.0.98' }
		});
		const page = await ctx.newPage();
		// Sign in as a regular user — admin is redirected away from /tickets/new.
		await signIn(page, USER_EMAIL);
		const titles = ['Cannot upload large videos', 'Dark email card in Outlook', '🔥 prod is down'];
		const bodies = [
			'Uploading a 15MB MP4 returns "size limit" but the docs say 20MB. Help?',
			'The billing email looks great in dark mode but renders white-on-white in Outlook light.',
			'500 across the board, started 14:02 UTC. Pasting logs when I can grab them.'
		];
		for (let i = 0; i < titles.length; i++) {
			try {
				await createTicket(page, { title: titles[i], body: bodies[i] });
			} catch {
				/* ignore — may already exist */
			}
		}
		await ctx.close();
	});

	test('login screen — dark + light', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		// Login renders with the SSR-supplied theme; just rely on doc cookie default.
		await page.screenshot({ path: `${SHOT_DIR}/login-dark.png`, animations: 'disabled' });
		await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
		await page.screenshot({ path: `${SHOT_DIR}/login-light.png`, animations: 'disabled' });
	});

	test('inbox + ticket detail (admin POV)', async ({ page }) => {
		await signIn(page, ADMIN_EMAIL);
		await page.goto('/tickets');
		await page.waitForLoadState('networkidle');
		await captureView(page, 'inbox', 'dark');
		await captureView(page, 'inbox', 'light');

		// First ticket → detail view.
		// The ticket rows use an absolutely-positioned overlay anchor; no .glass class.
		const firstTicket = page.locator('a[href^="/tickets/"]:not([href="/tickets/new"])').first();
		if (await firstTicket.isVisible()) {
			await firstTicket.click();
			await page.waitForURL(/\/tickets\/\d+/);
			await page.waitForLoadState('networkidle');
			await captureView(page, 'ticket-detail', 'dark');
			await captureView(page, 'ticket-detail', 'light');
		}
	});

	test('new ticket form', async ({ page }) => {
		await signIn(page, USER_EMAIL);
		await page.goto('/tickets/new');
		await page.waitForLoadState('networkidle');
		await captureView(page, 'new-ticket', 'dark');
		await captureView(page, 'new-ticket', 'light');
	});

	test('preferences page', async ({ page }) => {
		await signIn(page, USER_EMAIL);
		await page.goto('/preferences');
		await page.waitForLoadState('networkidle');
		await captureView(page, 'preferences', 'dark');
		await captureView(page, 'preferences', 'light');
	});

	test('admin settings', async ({ page }) => {
		await signIn(page, ADMIN_EMAIL);
		await page.goto('/admin');
		await page.waitForLoadState('networkidle');
		await captureView(page, 'admin', 'dark');
		await captureView(page, 'admin', 'light');
	});

	test('email preview (dark + light)', async ({ page }) => {
		await signIn(page, ADMIN_EMAIL);
		// Dark
		await setTheme(page, 'dark');
		await page.goto('/api/dev/email-preview');
		await page.screenshot({ path: `${SHOT_DIR}/email-dark.png`, animations: 'disabled' });
		// Light
		await setTheme(page, 'light');
		await page.goto('/api/dev/email-preview');
		await page.screenshot({ path: `${SHOT_DIR}/email-light.png`, animations: 'disabled' });
	});
});
