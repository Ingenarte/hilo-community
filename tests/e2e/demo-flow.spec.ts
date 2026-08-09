import { test, expect } from '@playwright/test';
import { signIn, todayDdmmyy } from './_helpers';

/**
 * Demo flow recorded as a webm video. Convert to GIF with the
 * `scripts/demo-to-gif.sh` script (ffmpeg required).
 *
 *   pnpm demo
 *   scripts/demo-to-gif.sh
 *
 * Drops into `docs/demo.webm` and `docs/demo.gif`.
 */

test.use({
	viewport: { width: 1280, height: 720 },
	video: {
		mode: 'on',
		size: { width: 1280, height: 720 }
	}
});

test('full demo: sign in → new ticket → admin reply → react', async ({ page, context }) => {
	// ─── User signs in ──────────────────────────────────────────────────────
	await page.goto('/login');
	await page.waitForTimeout(800);
	await page.locator('input#email').fill('demo-user@example.com');
	await page.locator('input#fixed').fill('1234');
	await page.locator('input#dynamic').fill(todayDdmmyy());
	await page.waitForTimeout(400);
	await page.locator('button[type="submit"]:has-text("Sign in")').click();
	await page.waitForURL(/\/tickets/);
	await page.waitForTimeout(800);

	// ─── Create a ticket ────────────────────────────────────────────────────
	await page.locator('a:has-text("New ticket")').first().click();
	await page.waitForURL(/\/tickets\/new/);
	await page.waitForTimeout(400);
	await page.locator('input[name="title"]').fill('Search returns no results for emoji');
	await page.locator('textarea[name="body"]').fill(
		'Trying to search "🔥" in the inbox returns 0 hits even though I have an urgent ticket open.\n\nSteps:\n- type 🔥 in the search box\n- expect to see the urgent ticket\n- actual: empty list'
	);
	await page.locator('button.chip:has-text("AETHER")').first().click();
	await page.waitForTimeout(400);
	await page.locator('button[type="submit"]:has-text("Create")').click();
	await page.waitForURL(/\/tickets\/\d+/);
	await page.waitForTimeout(1200);

	// ─── Send a follow-up with markdown ─────────────────────────────────────
	await page.locator('textarea').last().fill(
		'Also worth noting:\n\n- happens on **Firefox 128** and **Chrome 120**\n- the URL bar shows `?q=%F0%9F%94%A5`\n- works fine for plain ASCII\n\n```\ncurl /tickets?q=urgent\n```'
	);
	await page.waitForTimeout(800);
	await page.locator('button:has-text("Send")').click();
	await page.waitForTimeout(1200);

	// ─── React to a message ─────────────────────────────────────────────────
	const firstBubble = page.locator('.bubble-mine, .bubble-theirs').first();
	await firstBubble.hover();
	await page.waitForTimeout(400);
	const reactButton = page.locator('button[aria-label="React to message"]').first();
	if (await reactButton.isVisible()) {
		await reactButton.click();
		await page.waitForTimeout(300);
		await page.locator('button:has-text("🎉")').first().click();
		await page.waitForTimeout(600);
	}

	// ─── Toggle to light theme ──────────────────────────────────────────────
	await page.locator('button[aria-label*="Switch to"]').first().click();
	await page.waitForTimeout(1000);

	// ─── Back to inbox ──────────────────────────────────────────────────────
	await page.locator('a:has-text("← Back to inbox"), a[href="/tickets"]').first().click();
	await page.waitForURL(/\/tickets/);
	await page.waitForTimeout(1500);

	// Final pose — give the video a tail.
	await page.waitForTimeout(800);
});
