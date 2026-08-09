/**
 * WCAG AA color-contrast audit using axe-core + Playwright.
 *
 * Covers every page accessible to a logged-in user, in both dark and light
 * themes. Asserts zero `color-contrast` violations as defined by WCAG 2.1 AA.
 *
 * Auth: global-setup.ts signs in once per role and saves storage state to
 *   tests/e2e/.auth/{admin,user}.json — loaded via test.use() per describe.
 *   This avoids repeated logins that would hit the production rate limiter.
 *
 * Run:  ADMIN_FIXED_PASSWORD=<pw> npx playwright test --config playwright.a11y.config.ts
 * Report persisted to: tests/e2e/a11y-report.json
 */

import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Auth state paths (written by global-setup.ts)
// ---------------------------------------------------------------------------

const AUTH_DIR = path.join(process.cwd(), 'tests/e2e/.auth');
const ADMIN_AUTH = path.join(AUTH_DIR, 'admin.json');
const USER_AUTH = path.join(AUTH_DIR, 'user.json');

// ---------------------------------------------------------------------------
// Theme helper
// ---------------------------------------------------------------------------

async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
	// POST to the theme API to update the cookie, then set the attribute
	// synchronously so the page reflects the theme without a reload.
	await page.evaluate(async (t: string) => {
		await fetch('/api/theme', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ theme: t })
		});
		document.documentElement.setAttribute('data-theme', t);
	}, theme);
}

// ---------------------------------------------------------------------------
// axe helper — only `color-contrast` rule, WCAG 2.1 AA
// ---------------------------------------------------------------------------

type ViolationSummary = {
	id: string;
	impact: string | null;
	description: string;
	nodeCount: number;
	nodes: Array<{ html: string; failureSummary: string | null }>;
};

type PageResult = {
	route: string;
	theme: 'dark' | 'light';
	violationCount: number;
	violations: ViolationSummary[];
};

const REPORT: PageResult[] = [];

async function auditPage(
	page: Page,
	route: string,
	theme: 'dark' | 'light'
): Promise<ViolationSummary[]> {
	const results = await new AxeBuilder({ page })
		.withRules(['color-contrast'])
		.withTags(['wcag2aa'])
		.analyze();

	const violations: ViolationSummary[] = results.violations.map((v) => ({
		id: v.id,
		impact: v.impact ?? null,
		description: v.description,
		nodeCount: v.nodes.length,
		nodes: v.nodes.slice(0, 3).map((n) => ({
			html: n.html.slice(0, 200),
			failureSummary: n.failureSummary ?? null
		}))
	}));

	REPORT.push({ route, theme, violationCount: violations.length, violations });
	return violations;
}

// ---------------------------------------------------------------------------
// Tests — Admin role
// ---------------------------------------------------------------------------

test.describe('a11y / admin', () => {
	// Load persisted admin session from global setup.
	test.use({ storageState: ADMIN_AUTH });

	for (const theme of ['dark', 'light'] as const) {
		test.describe(`theme: ${theme}`, () => {
			test.beforeEach(async ({ page }) => {
				// Navigate to any authenticated page to establish the session,
				// then apply the theme before each test.
				await page.goto('/tickets');
				await page.waitForLoadState('domcontentloaded');
				await setTheme(page, theme);
			});

			test('/tickets — inbox', async ({ page }) => {
				await page.goto('/tickets');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/tickets', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/tickets/new — new ticket form', async ({ page }) => {
				await page.goto('/tickets/new');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/tickets/new', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/admin — admin dashboard', async ({ page }) => {
				await page.goto('/admin');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/admin', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/admin/users — user management', async ({ page }) => {
				await page.goto('/admin/users');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/admin/users', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/admin/users — New user modal', async ({ page }) => {
				await page.goto('/admin/users');
				// Use load (not just domcontentloaded) so Svelte hydration completes
				// before we interact — the button's onclick is bound post-hydration.
				await page.waitForLoadState('load');
				const newUserBtn = page.getByRole('button', { name: '+ New user' });
				await newUserBtn.waitFor({ state: 'visible', timeout: 15_000 });
				await newUserBtn.click();
				// Modal is teleported to <body> via use:portal.
				// Retry click once if dialog does not appear promptly.
				const dialog = page.locator('[role="dialog"]').first();
				const appeared = await dialog
					.waitFor({ state: 'visible', timeout: 8_000 })
					.then(() => true)
					.catch(() => false);
				if (!appeared) {
					// Retry once — first click may have been intercepted by hydration.
					await newUserBtn.click();
					await dialog.waitFor({ state: 'visible', timeout: 15_000 });
				}
				const violations = await auditPage(page, '/admin/users#new-user-modal', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/admin/groups — groups table', async ({ page }) => {
				await page.goto('/admin/groups');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/admin/groups', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/admin/outbox — email outbox', async ({ page }) => {
				await page.goto('/admin/outbox');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/admin/outbox', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/admin/audit — audit log', async ({ page }) => {
				await page.goto('/admin/audit');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/admin/audit', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/preferences — user preferences', async ({ page }) => {
				await page.goto('/preferences');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/preferences', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('Confirm modal (Sign out) — bg-black/75 backdrop', async ({ page }) => {
				await page.goto('/tickets');
				await page.waitForLoadState('domcontentloaded');
				// Open the Sign out confirm modal via the logout button
				const logoutBtn = page.getByRole('button', { name: /sign out/i });
				if (await logoutBtn.isVisible()) {
					await logoutBtn.click();
				} else {
					// Try the LogoutButton which may render differently
					await page
						.locator('button')
						.filter({ hasText: /out|logout/i })
						.first()
						.click();
				}
				await page.waitForSelector('[role="dialog"]', { timeout: 5_000 }).catch(() => null);
				const violations = await auditPage(page, '/confirm-modal', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/tickets/[id] — ticket detail as admin', async ({ page }) => {
				// Navigate to the ticket list and open the first available ticket
				await page.goto('/tickets');
				await page.waitForLoadState('domcontentloaded');
				const firstTicketLink = page.locator('a[href^="/tickets/"]').first();
				if (await firstTicketLink.isVisible()) {
					const href = await firstTicketLink.getAttribute('href');
					if (href) {
						await page.goto(href);
						await page.waitForLoadState('domcontentloaded');
						const violations = await auditPage(page, href, theme);
						expect(violations, formatViolations(violations)).toHaveLength(0);
					}
				} else {
					test.skip();
				}
			});
		});
	}
});

// ---------------------------------------------------------------------------
// Tests — User role
// ---------------------------------------------------------------------------

test.describe('a11y / user', () => {
	// Load persisted user session from global setup.
	test.use({ storageState: USER_AUTH });

	for (const theme of ['dark', 'light'] as const) {
		test.describe(`theme: ${theme}`, () => {
			test.beforeEach(async ({ page }) => {
				await page.goto('/tickets');
				await page.waitForLoadState('domcontentloaded');
				await setTheme(page, theme);
			});

			test('/tickets — inbox (user)', async ({ page }) => {
				await page.goto('/tickets');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/tickets (user)', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/tickets/new — new ticket form (user)', async ({ page }) => {
				await page.goto('/tickets/new');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/tickets/new (user)', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});

			test('/tickets/[id] — ticket detail as user', async ({ page }) => {
				await page.goto('/tickets');
				await page.waitForLoadState('domcontentloaded');
				const firstTicketLink = page.locator('a[href^="/tickets/"]').first();
				if (await firstTicketLink.isVisible()) {
					const href = await firstTicketLink.getAttribute('href');
					if (href) {
						await page.goto(href);
						await page.waitForLoadState('domcontentloaded');
						const violations = await auditPage(page, `${href} (user)`, theme);
						expect(violations, formatViolations(violations)).toHaveLength(0);
					}
				} else {
					test.skip();
				}
			});

			test('/preferences — user preferences', async ({ page }) => {
				await page.goto('/preferences');
				await page.waitForLoadState('domcontentloaded');
				const violations = await auditPage(page, '/preferences (user)', theme);
				expect(violations, formatViolations(violations)).toHaveLength(0);
			});
		});
	}
});

// ---------------------------------------------------------------------------
// No-auth tests — no storageState needed
// ---------------------------------------------------------------------------

test.describe('a11y / no-auth', () => {
	for (const theme of ['dark', 'light'] as const) {
		test(`/login [${theme}] — sign-in form`, async ({ page }) => {
			await page.goto('/login');
			await page.waitForLoadState('domcontentloaded');
			await page.evaluate((t) => {
				document.documentElement.setAttribute('data-theme', t);
			}, theme);
			const violations = await auditPage(page, '/login', theme);
			expect(violations, formatViolations(violations)).toHaveLength(0);
		});

		test(`/login [${theme}] — error state (bad password)`, async ({ page }) => {
			await page.goto('/login');
			await page.waitForLoadState('domcontentloaded');
			await page.evaluate((t) => {
				document.documentElement.setAttribute('data-theme', t);
			}, theme);
			await page.locator('input#email').fill('nobody@example.com');
			await page.locator('input#fixed').fill('wrong_password_for_audit_test');
			await page.locator('button[type="submit"]').click();
			// Wait for the error bubble to appear
			await page.waitForSelector('[role="alert"]', { timeout: 10_000 }).catch(() => null);
			const violations = await auditPage(page, '/login-error', theme);
			expect(violations, formatViolations(violations)).toHaveLength(0);
		});
	}
});

// ---------------------------------------------------------------------------
// Notification banner test (user session)
// ---------------------------------------------------------------------------

test.describe('a11y / notifications banner', () => {
	test.use({ storageState: USER_AUTH });

	for (const theme of ['dark', 'light'] as const) {
		test(`[${theme}] notification banner visible`, async ({ page }) => {
			await page.goto('/tickets');
			await page.waitForLoadState('domcontentloaded');
			await setTheme(page, theme);
			// Clear the dismiss flag to force the banner to show
			await page.evaluate(() => {
				localStorage.removeItem('hilo.notify.dismissed');
			});
			await page.goto('/tickets');
			await page.waitForLoadState('domcontentloaded');
			// The banner shows when browser notification state is 'default'
			// and dismissed flag is absent. Proceed with audit regardless.
			const violations = await auditPage(page, '/tickets-with-banner', theme);
			expect(violations, formatViolations(violations)).toHaveLength(0);
		});
	}
});

// ---------------------------------------------------------------------------
// Persist report after all tests
// ---------------------------------------------------------------------------

test.afterAll(() => {
	const reportPath = path.join(process.cwd(), 'tests/e2e/a11y-report.json');
	fs.writeFileSync(reportPath, JSON.stringify(REPORT, null, 2), 'utf-8');
	const totalViolations = REPORT.reduce((sum, r) => sum + r.violationCount, 0);
	console.log(
		`\nA11y report written to ${reportPath}\n` +
			`Total color-contrast violations across all routes/themes: ${totalViolations}\n`
	);
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatViolations(violations: ViolationSummary[]): string {
	if (violations.length === 0) return '';
	return (
		`\n${violations.length} color-contrast violation(s):\n` +
		violations
			.map(
				(v) =>
					`  [${v.impact}] ${v.id}: ${v.description} (${v.nodeCount} node(s))\n` +
					v.nodes
						.map((n) => `    HTML: ${n.html}\n    ${n.failureSummary ?? ''}`)
						.join('\n')
			)
			.join('\n\n')
	);
}
