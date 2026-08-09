/**
 * Regenerate the PWA/README screenshots with NEUTRAL demo data for the
 * public community mirror. Boots the community build on :3998 with a fresh
 * SQLite file, seeds demo users + tickets, drives a real browser, and writes:
 *
 *   community-assets/static/screenshot-inbox-wide.png    (1280x800)
 *   community-assets/static/screenshot-ticket-wide.png   (1280x800)
 *   community-assets/static/screenshot-inbox-narrow.png  (750x1334)
 *
 * scripts/sync-community.sh copies these over static/ in the mirror.
 * Usage: node scripts/shoot-community-screenshots.mjs <community-repo-path>
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes, scryptSync } from 'node:crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const COMMUNITY = process.argv[2] || '/Volumes/SecondHD/Hilo-community';
const OUT = join(ROOT, 'community-assets', 'static');
mkdirSync(OUT, { recursive: true });

if (!existsSync(join(COMMUNITY, 'build/index.js'))) {
  console.error('community build missing — run pnpm build in ' + COMMUNITY);
  process.exit(1);
}

const WORK = mkdtempSync(join(tmpdir(), 'hilo-shoot-'));
const DB = join(WORK, 'demo.db');
const PORT = 3998;
const BASE = `http://localhost:${PORT}`;

const hash = (pw) => {
  const salt = randomBytes(16);
  return `scrypt$N=16384,r=8,p=1$${salt.toString('base64')}$${scryptSync(pw, salt, 64).toString('base64')}`;
};

const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  ORIGIN: BASE,
  PUBLIC_BASE_URL: BASE,
  PUBLIC_BRAND: 'Hilo',
  ADMIN_EMAIL: 'admin@example.com',
  AUTH_FIXED_PASSWORD: 'demo-password',
  AUTH_DYNAMIC_FORMAT: 'none',
  SESSION_SECRET: 'screenshot-only-not-secure-0000000000000000000000000000',
  SMTP_HOST: 'localhost',
  SMTP_USER: 'demo@example.com',
  SMTP_PASS: 'unused',
  SMTP_DRYRUN: '1',
  DATABASE_PATH: DB,
  UPLOAD_DIR: join(WORK, 'uploads')
};

const server = spawn('node', ['build/index.js'], { cwd: COMMUNITY, env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3500));

// Seed demo content straight into the fresh DB.
const sql = (q) => execSync(`sqlite3 "${DB}"`, { input: q });
const aHash = hash('demo-password');
const uHash = hash('demo-password');
// The server auto-provisions the admin from ADMIN_EMAIL at boot — just set
// a known password on it, then add the demo user.
sql(`
UPDATE users SET password_hash='${aHash}' WHERE email='admin@example.com';
INSERT OR IGNORE INTO users (email, role, password_hash, last_seen) VALUES
 ('sofia@example.com','user','${uHash}',unixepoch());
INSERT OR IGNORE INTO projects (name, slug) VALUES ('Website','website');
`);
const uid = String(execSync(`sqlite3 "${DB}" "select id from users where email='sofia@example.com';"`)).trim();
const pid = String(execSync(`sqlite3 "${DB}" "select id from projects where slug='website';"`)).trim();
sql(`INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (${uid}, ${pid});`);
const tickets = [
  ['Checkout button unresponsive on mobile', 'high', 'Tapping “Pay now” on iPhone does nothing — no spinner, no error. Started after yesterday’s update.'],
  ['Feature request: export invoices as PDF', 'normal', 'It would save us a lot of time if the invoice list had a PDF export next to the CSV one.'],
  ['Typo on the pricing page', 'low', 'The Pro plan says “$29/monht”. Tiny thing, but it’s the first thing visitors see.'],
  ['Images in the gallery load slowly', 'normal', 'Product gallery takes 6–8 seconds on a fast connection. Maybe the images are not compressed?'],
  ['Password reset email never arrives', 'urgent', 'Two of our editors requested resets today and nothing landed in inbox or spam.']
];
for (const [title, prio, body] of tickets) {
  sql(`INSERT INTO tickets (user_id, title, status, priority, created_at, updated_at)
       VALUES (${uid}, '${title.replace(/'/g, "''")}', 'open', '${prio}', unixepoch()-3600, unixepoch()-1800);`);
  const tid = String(execSync(`sqlite3 "${DB}" "select max(id) from tickets;"`)).trim();
  sql(`INSERT INTO ticket_projects (ticket_id, project_id) VALUES (${tid}, ${pid});
       INSERT INTO messages (ticket_id, sender_id, sender_role, body, created_at)
       VALUES (${tid}, ${uid}, 'user', '${body.replace(/'/g, "''")}', unixepoch()-3600);`);
}
// A reply from the admin on ticket 1 so the thread looks alive.
sql(`INSERT INTO messages (ticket_id, sender_id, sender_role, body, created_at)
     SELECT 1, id, 'admin', 'Thanks for the report! Reproduced on iOS 18 — a fix is on the way, I''ll update you here today.', unixepoch()-900
     FROM users WHERE email='admin@example.com';`);

const browser = await chromium.launch();

async function login(page, email) {
  await page.goto(BASE + '/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="fixed"]', 'demo-password');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/tickets**', { timeout: 15000 }).catch(async () => {
    const body = await page.locator('body').textContent();
    throw new Error(`login failed for ${email}; page says: ${body?.slice(0, 300)}`);
  });
  // Dismiss the first-login install-help dialog if it auto-opened.
  await page.waitForTimeout(800);
  const dialogClose = page.locator('[role="dialog"] button[aria-label="Close"]').last();
  if (await dialogClose.isVisible().catch(() => false)) {
    await dialogClose.click();
    await page.waitForTimeout(400);
  }
}

// Wide inbox (admin view)
const wide = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await login(wide, 'admin@example.com');
await wide.goto(BASE + '/tickets');
await wide.waitForTimeout(1200);
await wide.screenshot({ path: join(OUT, 'screenshot-inbox-wide.png') });

// Wide ticket detail
await wide.locator('a[href^="/tickets/"]:not([href="/tickets/new"])').first().click();
await wide.waitForTimeout(1200);
await wide.screenshot({ path: join(OUT, 'screenshot-ticket-wide.png') });
await wide.close();

// Narrow inbox
const narrow = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
await login(narrow, 'sofia@example.com');
await narrow.goto(BASE + '/tickets');
await narrow.waitForTimeout(1200);
await narrow.screenshot({ path: join(OUT, 'screenshot-inbox-narrow.png') });
await narrow.close();

await browser.close();
server.kill();
rmSync(WORK, { recursive: true, force: true });
console.log('screenshots written to', OUT);
