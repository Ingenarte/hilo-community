import { expect, type Page } from '@playwright/test';

/**
 * Today's access code in `ddmmyy` form. Mirrors the server-side default.
 * Matches `AUTH_DYNAMIC_FORMAT=ddmmyy`.
 */
export function todayDdmmyy(d: Date = new Date()): string {
	const dd = String(d.getDate()).padStart(2, '0');
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const yy = String(d.getFullYear() % 100).padStart(2, '0');
	return `${dd}${mm}${yy}`;
}

export async function signIn(
	page: Page,
	email: string,
	{ accessCode = todayDdmmyy(), fixed = '1234' }: { accessCode?: string; fixed?: string } = {}
): Promise<void> {
	await page.goto('/login');
	await page.waitForLoadState('networkidle');
	await page.locator('input#email').fill(email);
	await page.locator('input#fixed').fill(fixed);
	await page.locator('input#dynamic').fill(accessCode);
	// SvelteKit enhance does a client-side redirect; click then wait for URL change.
	await page.locator('button[type="submit"]:has-text("Sign in")').click();
	await page.waitForURL(/\/tickets/, { timeout: 30_000 });
	await expect(page).toHaveURL(/\/tickets/);
}

export async function setTheme(page: Page, theme: 'dark' | 'light') {
	const ctx = page.context();
	const cookies = await ctx.cookies();
	const session = cookies.find((c) => c.name === 'hilo_session');
	if (!session) throw new Error('No session — sign in first.');
	await ctx.request.post('/api/theme', {
		headers: { 'Content-Type': 'application/json' },
		data: { theme }
	});
	await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

export async function createTicket(
	page: Page,
	args: { title: string; body: string; projects?: string[] }
): Promise<number> {
	await page.goto('/tickets/new');
	await page.locator('input[name="title"]').fill(args.title);
	await page.locator('textarea[name="body"]').fill(args.body);
	for (const proj of args.projects ?? ['Demo']) {
		// Press the chip button only if it is not already selected (active).
		// The selected state shows a checkmark prefix: "✓ Demo".
		const chip = page.locator(`button.chip:has-text("${proj}")`).first();
		if (await chip.isVisible()) {
			const label = await chip.textContent();
			const alreadySelected = label?.trim().startsWith('✓');
			if (!alreadySelected) await chip.click();
		}
	}
	await Promise.all([
		page.waitForURL(/\/tickets\/\d+/),
		page.locator('button[type="submit"]:has-text("Create")').click()
	]);
	const url = page.url();
	const id = Number(url.match(/\/tickets\/(\d+)/)?.[1] ?? '0');
	return id;
}
