/**
 * Browser verification for long-lived service tokens: an admin opens
 * Preferences, picks "Expires in: 1 year" in the agent token modal, allows
 * ticket creation restricted to one project, generates the token, then checks
 * that the token list shows the expiry date and the "Long-lived" label.
 * The token is written to OUT_DIR/token.txt so a curl call can use it.
 *
 * Usage (local dev, throwaway database):
 *   BASE=http://localhost:5199 ADMIN_EMAIL=admin@local.test ADMIN_PWD=admin-local-pw \
 *     PROJECT_NAME=Website node scripts/screenshot-service-token.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dir, '../audit-screenshots/service-token');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE ?? 'http://localhost:5199';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@local.test';
const ADMIN_PWD = process.env.ADMIN_PWD ?? 'admin-local-pw';
const PROJECT_NAME = process.env.PROJECT_NAME ?? 'Website';

const shot = async (page, name) => {
	const p = resolve(OUT_DIR, `${name}.png`);
	await page.screenshot({ path: p, fullPage: false });
	console.log(`  ok ${p}`);
};

const browser = await chromium.launch({ headless: true });
try {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
	await page.fill('input#email', ADMIN_EMAIL);
	await page.fill('input#fixed', ADMIN_PWD);
	await page.click('button[type="submit"]:has-text("Sign in")');
	await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
	await page.request.post(`${BASE}/api/me/seen-install-help`);

	await page.goto(`${BASE}/preferences`, { waitUntil: 'load' });
	await page.waitForTimeout(1500); // let the page hydrate
	await page.click('button:has-text("Generate token for all my tickets")');
	const ttl = page.locator('[data-testid="token-ttl"]');
	await ttl.waitFor();
	await ttl.selectOption({ label: '1 year' });
	await page.check('[data-testid="token-can-create"]');
	const proj = page.locator('[data-testid="token-project"]');
	await proj.locator(`option:has-text("${PROJECT_NAME}")`).waitFor({ state: 'attached' });
	await proj.selectOption({ label: PROJECT_NAME });
	const genBtn = page.locator('button:has-text("Generate token (1 year)")');
	await genBtn.waitFor();
	await shot(page, '01-modal-expires-in-1-year');

	const [resp] = await Promise.all([
		page.waitForResponse((r) => r.url().endsWith('/api/tokens') && r.request().method() === 'POST'),
		genBtn.click()
	]);
	const created = await resp.json();
	if (resp.status() !== 201) throw new Error(`POST /api/tokens returned ${resp.status()}`);
	const lifetimeDays = (created.info.expires_at - created.info.created_at) / 86400;
	console.log(`  token lifetime: ${lifetimeDays} days, can_create=${created.info.can_create}, project_id=${created.info.project_id}`);
	if (lifetimeDays !== 365 || !created.info.can_create || created.info.project_id == null) {
		throw new Error('Created token does not match the requested settings');
	}
	const expiryText = await page.locator('[data-testid="token-expiry"]').innerText();
	console.log(`  modal: ${expiryText}`);
	writeFileSync(resolve(OUT_DIR, 'token.txt'), created.token + '\n', { mode: 0o600 });
	await shot(page, '02-token-created-expiry');

	await page.click('button:has-text("Done")');
	const row = page.locator(`[data-token-id="${created.info.id}"]`);
	await row.waitFor();
	const label = await row.locator('[data-testid="token-long-lived"]').innerText();
	const expires = await row.locator('[data-testid="token-expires"]').innerText();
	console.log(`  list row: label="${label}" ${expires}`);
	if (label.trim() !== 'Long-lived' || !expires.includes(String(new Date(created.info.expires_at * 1000).getFullYear()))) {
		throw new Error('Token list does not show the long-lived label and expiry year');
	}
	await row.scrollIntoViewIfNeeded();
	await page.waitForTimeout(600); // modal fade-out
	await shot(page, '03-token-list-long-lived');
} finally {
	await browser.close();
}
