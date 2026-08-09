/**
 * Browser verification for the navbar Help ("?") install panel.
 *
 * Per CLAUDE.md we verify behaviour, not existence:
 *   - the "?" button opens the dialog,
 *   - every platform tab (iOS / Android / Windows / macOS) renders and its
 *     walkthrough video actually PLAYS (currentTime advances after .play()),
 *   - the Windows/macOS "Copy command" buttons put the EXACT startup command
 *     (byte-for-byte equal to src/lib/help/*) on the clipboard.
 *
 * Auth: injects a real session row for the local admin instead of logging in,
 * so no password is needed. The session row is deleted on exit.
 *
 * Usage:
 *   HELP_BASE=http://localhost:5180 node scripts/screenshot-help.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const OUT_DIR = resolve(ROOT, 'audit-screenshots/help');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.HELP_BASE ?? 'http://localhost:5180';
const DB_PATH = resolve(ROOT, process.env.DATABASE_PATH ?? './data/hilo.db');

const COMMAND_FILES = {
  windows: 'src/lib/help/startup-windows.ps1',
  macos: 'src/lib/help/startup-macos.command'
};

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── 1. Inject a session for the local admin ───────────────────────────────
const db = new Database(DB_PATH);
const admin = db
  .prepare("SELECT id, email FROM users WHERE role='admin' AND disabled_at IS NULL ORDER BY id LIMIT 1")
  .get();
if (!admin) {
  console.error('No admin user in', DB_PATH);
  process.exit(1);
}
const sid = randomBytes(32).toString('base64url');
db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run(sid, admin.id);
console.log(`Injected session for ${admin.email} (id=${admin.id})`);

const cleanup = () => {
  try {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    db.close();
  } catch {
    /* ignore */
  }
};

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required']
});

try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write']
  });
  await ctx.addCookies([{ name: 'hilo_session', value: sid, url: BASE }]);
  const page = await ctx.newPage();

  await page.goto(`${BASE}/tickets`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  // ── 2. Open the panel ───────────────────────────────────────────────────
  const helpBtn = page.locator('button[aria-label^="Help"]');
  await helpBtn.waitFor({ state: 'visible', timeout: 20000 });
  record('Help button present in navbar', true);
  await helpBtn.click();

  const dialog = page.locator('[role="dialog"][aria-labelledby="help-dialog-title"]');
  await dialog.waitFor({ state: 'visible', timeout: 8000 });
  record('Dialog opens', true);

  // ── 3. Each platform tab: video plays + content ────────────────────────
  const tabs = ['ios', 'android', 'windows', 'macos'];
  for (const key of tabs) {
    const tab = page.locator(`#help-tab-${key}`);
    await tab.click();
    await page.waitForTimeout(400);

    const video = page.locator('video');
    await video.waitFor({ state: 'visible', timeout: 8000 });

    // Force playback and confirm currentTime actually advances.
    const played = await video.evaluate(async (el) => {
      const v = /** @type {HTMLVideoElement} */ (el);
      try {
        await v.play();
      } catch {
        /* autoplay already running */
      }
      const start = v.currentTime;
      await new Promise((r) => setTimeout(r, 900));
      return { advanced: v.currentTime > start && v.currentTime > 0, t: v.currentTime, src: v.currentSrc };
    });
    record(
      `[${key}] video plays`,
      played.advanced,
      `currentTime=${played.t.toFixed(2)}s src=${played.src.split('/').pop()}`
    );

    // Steps render (4 list items).
    const stepCount = await page.locator('[role="dialog"] ol > li').count();
    record(`[${key}] install steps render`, stepCount >= 3, `${stepCount} steps`);

    await page.waitForTimeout(300);
    const shot = resolve(OUT_DIR, `panel-${key}.png`);
    await page.screenshot({ path: shot });
    console.log(`    saved ${shot}`);
  }

  // ── 4. Copy command (Windows + macOS) ──────────────────────────────────
  for (const key of ['windows', 'macos']) {
    await page.locator(`#help-tab-${key}`).click();
    await page.waitForTimeout(300);

    const expected = readFileSync(resolve(ROOT, COMMAND_FILES[key]), 'utf8').trim();
    const copyBtn = page.locator('[role="dialog"] button', { hasText: 'Copy command' });
    await copyBtn.click();
    await page.waitForTimeout(250);

    const clip = (await page.evaluate(() => navigator.clipboard.readText())).trim();
    const match = clip === expected;
    record(
      `[${key}] Copy command → clipboard matches file`,
      match,
      match ? `${clip.length} chars` : `clip(${clip.length}) !== file(${expected.length})`
    );

    // Button confirms with "Copied".
    const confirmed = await page
      .locator('[role="dialog"] button', { hasText: 'Copied' })
      .first()
      .isVisible()
      .catch(() => false);
    record(`[${key}] Copy button shows confirmation`, confirmed);

    // expand the "Remove from startup" details so the undo command shows too
    await page.locator('[role="dialog"] details summary').click().catch(() => {});
    await page.waitForTimeout(200);
    const shot = resolve(OUT_DIR, `copy-${key}.png`);
    await page.screenshot({ path: shot });
    console.log(`    saved ${shot}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} — ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name} ${f.detail}`);
  }
  await browser.close();
  cleanup();
  process.exit(failed.length === 0 ? 0 : 2);
} catch (err) {
  console.error('ERROR:', err);
  await browser.close().catch(() => {});
  cleanup();
  process.exit(1);
}
