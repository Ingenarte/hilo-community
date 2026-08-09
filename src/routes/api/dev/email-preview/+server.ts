import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { renderEmailHtml } from '$lib/server/email';
import { config } from '$lib/server/env';

/**
 * Dev-only preview of the message-notification email rendered with the
 * current user's preferred theme. Useful to inspect dark vs. light styling
 * (and the attachment layout) without sending an actual email. Note that
 * inline images use the cid: scheme which only resolves in real email
 * clients — the placeholders here show as broken icons in the browser.
 */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const html = renderEmailHtml({
		theme: locals.user.theme,
		brand: config.brand,
		ticketId: 42,
		title: 'Demo ticket — email preview',
		authorLabel: 'The admin',
		previewHtml:
			'This is a preview of the notification email rendered with your <strong>current theme</strong>. Change the theme in the navbar and refresh to see the light variant.',
		inlineImages: [
			{ cid: 'demo-img@hilo', filename: 'screenshot.png', size: 184_300 }
		],
		otherFiles: [
			{ filename: 'logs.txt', mime: 'text/plain', size: 12_400 },
			{ filename: 'report.pdf', mime: 'application/pdf', size: 482_100 },
			{ filename: 'archive.zip', mime: 'application/zip', size: 4_200_000 }
		],
		url: `${config.publicBaseUrl}/m/preview-token`,
		publicBaseUrl: config.publicBaseUrl
	});

	return new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
};
