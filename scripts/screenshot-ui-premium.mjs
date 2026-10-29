/**
 * Visual pass for the premium UI refresh: inbox, ticket, queue, login,
 * at desktop and phone widths, in dark and light themes. Also exercises
 * the new navbar menus, the inbox selection checkbox and the segmented
 * priority control so the capture shows behaviour, not just presence.
 *
 * Usage (local staging, seeded):
 *   BASE=http://localhost:3001 ADMIN_EMAIL=admin@local.test ADMIN_PWD=admin-local-pw \
 *     node scripts/screenshot-ui-premium.mjs
 */

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dir, '../audit-screenshots/ui-premium');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE ?? 'http://localhost:3001';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@local.test';
const ADMIN_PWD = process.env.ADMIN_PWD ?? 'admin-local-pw';

const shot = async (page, name) => {
	const p = resolve(OUT_DIR, `${name}.png`);
	await page.screenshot({ path: p, fullPage: false });
	console.log(`  ok ${p}`);
};

async function signIn(page) {
	await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
	await page.fill('input#email', ADMIN_EMAIL);
	await page.fill('input#fixed', ADMIN_PWD);
	await page.click('button[type="submit"]:has-text("Sign in")');
	await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
	// First login opens the install guide; mark it seen so it stays out of the captures.
	await page.request.post(`${BASE}/api/me/seen-install-help`);
}

async function setTheme(page, theme) {
	await page.request.post(`${BASE}/api/theme`, { data: { theme } });
	await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

const browser = await chromium.launch({ headless: true });
const failures = [];
try {
	// ---------- Desktop ----------
	const ctx = await browser.newContext({
		viewport: { width: 1280, height: 860 },
		deviceScaleFactor: 2,
		extraHTTPHeaders: { 'X-Forwarded-For': '10.0.0.77' }
	});
	const page = await ctx.newPage();
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await shot(page, 'login-desktop-dark');

	// Font actually loaded?
	const fontOk = await page.evaluate(async () => {
		await document.fonts.ready;
		return document.fonts.check('16px Inter');
	});
	console.log(`  font Inter loaded: ${fontOk}`);
	if (!fontOk) failures.push('Inter webfont did not load');

	await signIn(page);
	await setTheme(page, 'dark');
	await page.goto(`${BASE}/tickets`, { waitUntil: 'load' });
	await page.waitForTimeout(600);
	await shot(page, 'inbox-desktop-dark');

	// Navbar: Admin dropdown opens and lists the admin pages.
	await page.getByTestId('nav-admin').click();
	await page.waitForSelector('[role="menu"] .menu-item:has-text("Users")');
	await page.waitForTimeout(300);
	await shot(page, 'inbox-admin-menu');
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);

	// Navbar: account menu holds Preferences and Sign out.
	await page.getByTestId('nav-account').click();
	await page.waitForSelector('[data-testid="menu-sign-out"]');
	await page.waitForTimeout(300);
	await shot(page, 'inbox-account-menu');
	await page.keyboard.press('Escape');

	// Inbox: hover reveals the checkbox, ticking it opens the bulk bar.
	const row = page.locator('[data-testid="inbox-list"] li').first();
	await row.hover();
	const cb = row.locator('input[type="checkbox"]');
	await cb.check();
	await page.waitForSelector('[data-testid="bulk-bar"]');
	const selectedClass = await row.locator('article').getAttribute('class');
	if (!selectedClass?.includes('is-selected')) failures.push('row did not get is-selected');
	await shot(page, 'inbox-row-selected');
	await page.getByTestId('bulk-clear').click();

	// Ticket page: segmented priority flips the value server side.
	await row.locator('a[href^="/tickets/"]').first().click();
	await page.waitForURL(/\/tickets\/\d+/);
	await page.waitForTimeout(600);
	await shot(page, 'ticket-desktop-dark');
	const current = await page.locator('select[name="priority"]').inputValue();
	const target = current === 'high' ? 'normal' : 'high';
	await page.getByTestId(`priority-${target}`).click();
	await page.waitForFunction(
		(t) => document.querySelector(`[data-testid="priority-${t}"]`)?.getAttribute('aria-pressed') === 'true',
		target,
		{ timeout: 10000 }
	);
	const after = await page.locator('select[name="priority"]').inputValue();
	if (after !== target) failures.push(`priority did not change: ${after} != ${target}`);
	await shot(page, 'ticket-priority-changed');
	// put it back
	await page.getByTestId(`priority-${current}`).click();
	await page.waitForTimeout(800);

	await page.goto(`${BASE}/queue`, { waitUntil: 'load' });
	await page.waitForTimeout(700);
	await shot(page, 'queue-desktop-dark');

	// Light theme pass.
	await setTheme(page, 'light');
	await page.goto(`${BASE}/tickets`, { waitUntil: 'load' });
	await page.waitForTimeout(400);
	await shot(page, 'inbox-desktop-light');
	await row.locator('a[href^="/tickets/"]').first().click();
	await page.waitForURL(/\/tickets\/\d+/);
	await page.waitForTimeout(600);
	await shot(page, 'ticket-desktop-light');
	await setTheme(page, 'dark');
	await ctx.close();

	// ---------- Phone ----------
	const mctx = await browser.newContext({
		...devices['iPhone 13'],
		extraHTTPHeaders: { 'X-Forwarded-For': '10.0.0.78' }
	});
	const m = await mctx.newPage();
	await signIn(m);
	await m.goto(`${BASE}/tickets`, { waitUntil: 'load' });
	await m.waitForTimeout(500);
	await shot(m, 'inbox-phone-dark');
	await m.locator('[data-testid="inbox-list"] a[href^="/tickets/"]').first().click();
	await m.waitForURL(/\/tickets\/\d+/);
	await m.waitForTimeout(600);
	await shot(m, 'ticket-phone-dark');
	await m.getByLabel('Show ticket info').click();
	await m.waitForTimeout(400);
	await shot(m, 'ticket-phone-info-drawer');
	await mctx.close();
} finally {
	await browser.close();
}

if (failures.length) {
	console.error('FAILURES:\n - ' + failures.join('\n - '));
	process.exit(1);
}
console.log('PASS');
