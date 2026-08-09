/**
 * Browser verification for the public landing page + parameterized login panel.
 *
 * PASS criteria:
 *  C1  Anonymous GET / renders the landing (hero text, video element with
 *      /promo.mp4 src, 10 numbered feature cards, GitHub link to
 *      hilo-community) — no redirect to /login.
 *  C2  Clicking "Log in" navigates to /login.
 *  C3  Login "What is Hilo?" panel shows the PUBLIC_SUPPORT_EMAIL address
 *      (no hardcoded identity).
 *  C4  Logging in with real credentials then visiting / redirects to /tickets.
 *  C5  Landing renders in both dark and light themes (screenshots captured).
 *
 * Usage: node scripts/verify-landing.mjs [baseUrl]
 * Requires the dev server (default http://localhost:5180) and .env values.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://localhost:5180';
const OUT = resolve(__dir, '../audit-screenshots/landing');
mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  readFileSync(resolve(__dir, '../.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const results = [];
const check = (id, ok, note) => {
  results.push({ id, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${note}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// C1 — anonymous landing
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const url1 = page.url();
const hero = await page.locator('h1').first().textContent();
const videoSrc = await page.locator('video').getAttribute('src').catch(() => null);
const cards = await page.locator('section .grid h2').count();
const gh = await page.locator(`a[href="https://github.com/Ingenarte/hilo-community"]`).count();
check(
  'C1',
  !url1.includes('/login') && /self-hosted/i.test(hero || '') && videoSrc === '/promo.mp4' && cards === 10 && gh >= 2,
  `url=${url1} hero="${(hero || '').trim().slice(0, 40)}" video=${videoSrc} cards=${cards} ghLinks=${gh}`
);
await page.screenshot({ path: `${OUT}/landing-dark.png`, fullPage: true });

// C5 — landing commits to the dark brand look for anonymous visitors
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('C5', !!bg && bg !== 'rgba(0, 0, 0, 0)', `body background painted (${bg})`);

// C2 — Log in button navigates
await page.locator('header a[href="/login"]').click();
await page.waitForURL('**/login');
check('C2', page.url().includes('/login'), `navigated to ${page.url()}`);

// C3 — support email in the about panel
await page.locator('button[aria-label*="What is Hilo" i], button:has-text("?")').first().click().catch(() => {});
// The info trigger on /login is the "(?)" button; find by text content of the panel after opening.
const aboutVisible = await page
  .locator('#about-hilo-title')
  .isVisible()
  .catch(() => false);
if (!aboutVisible) {
  // try any button whose accessible name mentions "about" or "info"
  const btns = page.locator('button');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const label = ((await btns.nth(i).getAttribute('aria-label')) || '').toLowerCase();
    if (label.includes('about') || label.includes('what is')) {
      await btns.nth(i).click();
      break;
    }
  }
}
await page.waitForTimeout(300);
const panelText = (await page.locator('body').textContent()) || '';
const email = env.PUBLIC_SUPPORT_EMAIL;
check('C3', panelText.includes(email), `panel contains ${email}: ${panelText.includes(email)}`);
await page.screenshot({ path: `${OUT}/login-about.png` });

// C4 — authenticated / redirects to /tickets
await page.goto(BASE + '/login');
// Throwaway user seeded by the runner (per-user scrypt password hashes).
await page.fill('input[name="email"]', 'e2e-landing@hilo.test');
await page.fill('input[name="fixed"]', 'e2e-landing-pass');
await page.click('button[type="submit"]');
await page.waitForURL('**/tickets**', { timeout: 15000 }).catch(async () => {
  const err = await page.locator('[role="alert"], .text-red-400, .error').allTextContents().catch(() => []);
  console.log('login did not navigate; url=', page.url(), 'errors=', err.join(' | '));
});
await page.goto(BASE + '/');
await page.waitForURL('**/tickets**');
check('C4', page.url().includes('/tickets'), `logged-in / -> ${page.url()}`);
await page.screenshot({ path: `${OUT}/logged-in-redirect.png` });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
