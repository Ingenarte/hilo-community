/**
 * Transactional email renderer + sender for Hilo.
 *
 * Table-based HTML, inline styles only — email clients do not honor
 * CSS variables, <style> blocks, or external CSS. Default theme: dark.
 * Light mode is offered when the recipient explicitly asked for it
 * (users.theme === 'light').
 *
 * The public surface is two functions:
 *   - `renderEmailHtml(args)` — pure HTML renderer (used by previews + tests).
 *   - `sendMessageNotification(args)` — composes + enqueues into the
 *     persistent outbox, which drains via `mailQueue.ts`.
 */

import { config } from './env';
import { createMagicLink, magicLinkUrl } from './magic';
import { uploadPath } from './uploads';
import { db } from './db';
import { drain, enqueueEmail } from './mailQueue';
import { nextSendTime } from './schedule';
import { canSendToday, markSent } from './email-throttle';
import { fmtBytes, escapeHtml, iconForMime, truncate } from './utils';

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

export type EmailAttachment = {
	id: number;
	filename: string;
	stored_name: string;
	mime_type: string;
	size_bytes: number;
};

type NotifyArgs = {
	to: string;
	recipientUserId: number;
	ticketId: number;
	ticketTitle: string;
	authorEmail: string;
	authorRole: 'user' | 'admin';
	preview: string;
	attachments?: EmailAttachment[];
};

function getUserSchedule(userId: number): string {
	const row = db
		.prepare('SELECT email_schedule FROM users WHERE id = ?')
		.get(userId) as { email_schedule: string } | undefined;
	return row?.email_schedule ?? 'immediate';
}

export type RenderEmailArgs = {
  theme: 'dark' | 'light';
  brand: string;
  ticketId: number;
  title: string;
  /** "The admin" or "user@example.com" */
  authorLabel: string;
  /** Already HTML-escaped + maybe-trimmed message body */
  previewHtml: string;
  inlineImages: Array<{ cid: string; filename: string; size: number }>;
  otherFiles: Array<{ filename: string; mime: string; size: number }>;
  /** Magic-link URL (one-shot, 30-day) */
  url: string;
  publicBaseUrl: string;
};

type Palette = {
  page: string;
  card: string;
  cardBorder: string;
  body: string;
  heading: string;
  accent: string;
  accent2: string;
  muted: string;
  faint: string;
  faintest: string;
  bubble: string;
  bubbleBorder: string;
  chip: string;
  chipBorder: string;
  btnText: string;
};

// Email clients (Gmail web/iOS, Outlook) strip rgba()/gradient backgrounds
// and re-render them transparent over their own background — which means a
// dark email would appear white on those clients. So the dark palette uses
// *solid* hex colors throughout and we mirror them with bgcolor attributes
// on the wrapping tables.
const DARK: Palette = {
  page: '#0b0f1a',
  card: '#141a2b',
  cardBorder: '#222a3f',
  body: '#e6e7eb',
  heading: '#ffffff',
  accent: '#a78bfa',
  accent2: '#67e8f9',
  muted: '#9ca3af',
  faint: '#6b7280',
  faintest: '#52525b',
  bubble: '#0a0f1c',
  bubbleBorder: '#222a3f',
  chip: '#1a2034',
  chipBorder: '#2a3247',
  btnText: '#0b0f1a'
};

const LIGHT: Palette = {
  page: '#f5f7fb',
  card: 'linear-gradient(145deg, #ffffff, #fbfcfe)',
  cardBorder: 'rgba(31,41,55,0.08)',
  body: '#1f2937',
  heading: '#0b0f1a',
  accent: '#7c3aed',
  accent2: '#0891b2',
  muted: '#4b5563',
  faint: '#6b7280',
  faintest: '#9ca3af',
  bubble: 'rgba(255,255,255,0.85)',
  bubbleBorder: 'rgba(31,41,55,0.08)',
  chip: 'rgba(0,0,0,0.03)',
  chipBorder: 'rgba(31,41,55,0.1)',
  btnText: '#ffffff'
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function renderEmailHtml(args: RenderEmailArgs): string {
  // Hilo emails are always dark — light mode in clients (Gmail mobile, etc.)
  // is overridden via the <style> block + bgcolor attrs below.
  void args.theme;
  const c = DARK;
  const safeTitle = escapeHtml(args.title);
  const safeBrand = escapeHtml(args.brand);
  const safeAuthor = escapeHtml(args.authorLabel);
  const safeUrl = args.url;

  const inlineImagesHtml = args.inlineImages
    .map(
      (img) => `
        <div style="margin-top:14px;">
          <a href="${safeUrl}" style="text-decoration:none;display:block;">
            <img src="cid:${img.cid}" alt="${escapeHtml(img.filename)}"
                 style="display:block;max-width:100%;height:auto;border-radius:10px;
                        border:1px solid ${c.cardBorder};" />
          </a>
          <div class="faint" style="margin-top:4px;font-size:11px;color:${c.faint};">
            📷 ${escapeHtml(img.filename)} · ${fmtBytes(img.size)}
          </div>
        </div>`
    )
    .join('');

  const otherFilesHtml = args.otherFiles
    .map(
      (f) => `
        <a href="${safeUrl}" style="text-decoration:none;display:block;margin-top:10px;">
          <div class="chip" bgcolor="${c.chip}" style="display:inline-block;padding:8px 12px;
                      background:${c.chip};border:1px solid ${c.chipBorder};
                      border-radius:10px;font-size:12px;color:${c.body};">
            <span style="display:inline-block;margin-right:6px;">${iconForMime(f.mime)}</span>
            <strong style="color:${c.body};">${escapeHtml(f.filename)}</strong>
            <span class="faint" style="color:${c.faint};margin-left:8px;">${fmtBytes(f.size)}</span>
          </div>
        </a>`
    )
    .join('');

  // Force dark on every email client. Gmail mobile (iOS/Android) and
  // Outlook.com strip backgrounds and re-apply their own when the system is
  // in light mode; [data-ogsc] / [data-ogsb] are wrapper attributes those
  // clients add to the body, and we override the override through them.
  // `color-scheme: only dark` opts the email out of light/auto inversion.
  const forceDarkCss = `
    :root, html, body { color-scheme: only dark !important; supported-color-schemes: only dark !important; }
    body, table, td, div, p, span, a { color: ${c.body} !important; }
    body, .page, .page td { background-color: ${c.page} !important; }
    .card { background-color: ${c.card} !important; }
    .bubble { background-color: ${c.bubble} !important; }
    .chip { background-color: ${c.chip} !important; }
    .heading { color: ${c.heading} !important; }
    .muted { color: ${c.muted} !important; }
    .faint { color: ${c.faint} !important; }
    .faintest { color: ${c.faintest} !important; }
    .accent { color: ${c.accent} !important; }
    .btn-text { color: ${c.btnText} !important; }
    [data-ogsc] body, [data-ogsb] body { background-color: ${c.page} !important; color: ${c.body} !important; }
    [data-ogsc] .page, [data-ogsb] .page { background-color: ${c.page} !important; }
    [data-ogsc] .card, [data-ogsb] .card { background-color: ${c.card} !important; }
    [data-ogsc] .bubble, [data-ogsb] .bubble { background-color: ${c.bubble} !important; }
    [data-ogsc] .chip, [data-ogsb] .chip { background-color: ${c.chip} !important; }
    [data-ogsc] *, [data-ogsb] * { color: inherit !important; }
    @media (prefers-color-scheme: light) {
      body, .page, .page td { background-color: ${c.page} !important; }
      .card { background-color: ${c.card} !important; }
      .bubble { background-color: ${c.bubble} !important; }
    }
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="only dark" />
<meta name="supported-color-schemes" content="only dark" />
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
<title>${safeBrand} · #${args.ticketId}</title>
<style>${forceDarkCss}</style>
<!--[if mso]>
<style>
  body, table, td { background-color: ${c.page} !important; color: ${c.body} !important; }
</style>
<![endif]-->
</head>
<body bgcolor="${c.page}" style="margin:0;padding:0;background:${c.page};color:${c.body};
             font-family:${FONT_STACK};line-height:1.5;">
  <span style="display:none !important;visibility:hidden;opacity:0;height:0;width:0;color:transparent;
               max-height:0;max-width:0;overflow:hidden;mso-hide:all;">
    ${safeAuthor} sent a new message on ticket #${args.ticketId}.
  </span>

  <table role="presentation" class="page" width="100%" cellspacing="0" cellpadding="0" border="0"
         bgcolor="${c.page}"
         style="background:${c.page};padding:32px 12px;">
    <tr>
      <td align="center" class="page" bgcolor="${c.page}" style="background:${c.page};">
        <table role="presentation" class="card" width="600" cellspacing="0" cellpadding="0" border="0"
               bgcolor="${c.card}"
               style="max-width:600px;width:100%;background:${c.card};
                      border:1px solid ${c.cardBorder};border-radius:16px;
                      padding:28px;box-shadow:0 24px 60px -20px rgba(0,0,0,0.18);">
          <tr><td class="card" bgcolor="${c.card}" style="background:${c.card};">

            <div class="accent" style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;
                        color:${c.accent};font-weight:700;margin-bottom:6px;">
              ${safeBrand} · ticket #${args.ticketId}
            </div>

            <div class="heading" style="font-size:20px;font-weight:700;color:${c.heading};
                        line-height:1.3;margin-bottom:14px;letter-spacing:-0.01em;">
              ${safeTitle}
            </div>

            <div class="muted" style="font-size:13px;color:${c.muted};margin-bottom:14px;">
              ${safeAuthor} just sent a new message.
            </div>

            <div class="bubble" bgcolor="${c.bubble}" style="font-size:14px;line-height:1.55;color:${c.body};
                        background:${c.bubble};border:1px solid ${c.bubbleBorder};
                        border-radius:12px;padding:14px 16px;white-space:pre-wrap;
                        word-break:break-word;">${args.previewHtml}</div>

            ${inlineImagesHtml}
            ${otherFilesHtml}

            <div style="margin-top:22px;">
              <a href="${safeUrl}" class="btn-text"
                 style="display:inline-block;padding:12px 22px;
                        background:${c.accent};
                        color:${c.btnText};font-weight:700;text-decoration:none;
                        border-radius:12px;font-size:14px;letter-spacing:-0.01em;">
                Open conversation →
              </a>
            </div>

            <div class="faint" style="margin-top:20px;font-size:12px;color:${c.faint};word-break:break-all;line-height:1.55;">
              Direct link:
              <a class="accent" style="color:${c.accent};text-decoration:none;" href="${safeUrl}">${safeUrl}</a><br />
              <span class="faintest" style="color:${c.faintest};">
                This link signs you in automatically. Single-use, expires in 30 days.
              </span>
            </div>

          </td></tr>
        </table>

        <div class="faintest" style="font-size:11px;color:${c.faintest};margin-top:16px;">
          Sent by ${safeBrand} · ${escapeHtml(args.publicBaseUrl)}
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Compose + enqueue a new-message notification. The queue worker
 * (`mailQueue.ts`) handles the actual SMTP send.
 *
 * Image attachments under 5 MB are embedded inline (via CID). Larger
 * images and non-image files become chips in the body and are reachable
 * via the magic-link button.
 *
 * Optional `extraRecipients` are CC'd plain email addresses (ticket
 * followers without a Hilo account). They share the primary recipient's
 * schedule window and get a stripped-down body without the magic-link.
 */
export async function sendMessageNotification(
	args: NotifyArgs & { extraRecipients?: string[] }
): Promise<void> {
	const token = createMagicLink(args.recipientUserId, args.ticketId);
	const url = magicLinkUrl(token);
	const preview = truncate(args.preview);
	const isAdminAuthor = args.authorRole === 'admin';
	const subject = `[${config.brand}] #${args.ticketId} · ${args.ticketTitle}`;

	const allAttachments = args.attachments ?? [];
	const inlineImages = allAttachments.filter(
		(a) => a.mime_type.startsWith('image/') && a.size_bytes <= MAX_INLINE_IMAGE_BYTES
	);
	const otherFiles = allAttachments.filter(
		(a) => !(a.mime_type.startsWith('image/') && a.size_bytes <= MAX_INLINE_IMAGE_BYTES)
	);

	const text = [
		`${isAdminAuthor ? 'Admin' : args.authorEmail} replied on ticket #${args.ticketId} — ${args.ticketTitle}`,
		'',
		preview || '(no message body)',
		allAttachments.length > 0
			? '\nAttachments:\n' +
				allAttachments
					.map((a) => `  • ${a.filename} (${fmtBytes(a.size_bytes)})`)
					.join('\n')
			: '',
		'',
		'Open the conversation:',
		url
	]
		.filter(Boolean)
		.join('\n');

	const html = renderEmailHtml({
		theme: 'dark',
		brand: config.brand,
		ticketId: args.ticketId,
		title: args.ticketTitle,
		authorLabel: isAdminAuthor ? 'The admin' : escapeHtml(args.authorEmail),
		previewHtml: escapeHtml(preview) || `<em style="color:#9ca3af;">(no message body)</em>`,
		inlineImages: inlineImages.map((a) => ({
			cid: `att${a.id}@hilo`,
			filename: a.filename,
			size: a.size_bytes
		})),
		otherFiles: otherFiles.map((a) => ({
			filename: a.filename,
			mime: a.mime_type,
			size: a.size_bytes
		})),
		url,
		publicBaseUrl: config.publicBaseUrl
	});

	const mailAttachments = inlineImages.map((a) => ({
		filename: a.filename,
		path: uploadPath(a.stored_name),
		cid: `att${a.id}@hilo`,
		contentType: a.mime_type
	}));

	const scheduleKey = getUserSchedule(args.recipientUserId);

	// Throttle: cap unread-message emails at one per calendar day in the user's
	// timezone. In-app SSE and web push are NOT affected — only email is gated.
	// markSent is stamped BEFORE enqueueEmail so that a failure at enqueue time
	// fails closed (one skipped email) rather than open (duplicate emails).
	if (!canSendToday(args.recipientUserId, 'message-unread', scheduleKey)) {
		console.log(
			`[email] throttled message-unread email for user ${args.recipientUserId}` +
				` (already sent today in schedule "${scheduleKey}")`
		);
		return;
	}
	markSent(args.recipientUserId, 'message-unread');

	const sendAfter = nextSendTime(scheduleKey);
	enqueueEmail({
		userId: args.recipientUserId,
		to: args.to,
		subject,
		text,
		html,
		attachments: mailAttachments,
		sendAfter
	});

	// Plain-email CC list (followers without a Hilo account): same body
	// but the magic-link button is stripped — they can't auto-login.
	for (const extra of args.extraRecipients ?? []) {
		const ccText = text.replace(
			/Open the conversation:[\s\S]*$/,
			"(You are CC'd on this ticket; no auto-login link.)"
		);
		const ccHtml = html.replace(
			/<a href="[^"]*" style="display:inline-block;padding:12px[^>]*>Open conversation →<\/a>/,
			'<span style="display:inline-block;padding:8px 12px;font-size:12px;opacity:.7;">(CC — no auto-login link)</span>'
		);
		enqueueEmail({
			userId: null,
			to: extra,
			subject,
			text: ccText,
			html: ccHtml,
			attachments: mailAttachments,
			sendAfter
		});
	}

	// Drain right away so "immediate" recipients see the email without
	// waiting for the next polling tick.
	void drain();
}

/**
 * Lightweight email for "someone just assigned you a task". Re-uses the
 * existing magic-link + outbox queue so the recipient lands directly
 * on the ticket on click, and so the email respects their notification
 * window the same way message replies do.
 */
export async function sendTaskNotification(args: {
	to: string;
	recipientUserId: number;
	ticketId: number;
	ticketTitle: string;
	authorEmail: string;
	taskTitle: string;
	taskDescription: string;
}): Promise<void> {
	const token = createMagicLink(args.recipientUserId, args.ticketId);
	const url = magicLinkUrl(token);
	const subject = `[${config.brand}] New task · ${args.ticketTitle}`;
	const desc = (args.taskDescription ?? '').trim();

	const text = [
		`${args.authorEmail} assigned you a task on ticket #${args.ticketId} — ${args.ticketTitle}`,
		'',
		`Task: ${args.taskTitle}`,
		desc ? `\n${desc}` : '',
		'',
		'Open the conversation:',
		url
	]
		.filter(Boolean)
		.join('\n');

	const previewHtml =
		`<strong>${escapeHtml(args.taskTitle)}</strong>` +
		(desc ? `<br/><span style="color:#9ca3af;">${escapeHtml(desc)}</span>` : '');

	const html = renderEmailHtml({
		theme: 'dark',
		brand: config.brand,
		ticketId: args.ticketId,
		title: args.ticketTitle,
		authorLabel: `${escapeHtml(args.authorEmail)} assigned you a task`,
		previewHtml,
		inlineImages: [],
		otherFiles: [],
		url,
		publicBaseUrl: config.publicBaseUrl
	});

	const sendAfter = nextSendTime(getUserSchedule(args.recipientUserId));
	enqueueEmail({
		userId: args.recipientUserId,
		to: args.to,
		subject,
		text,
		html,
		sendAfter
	});
	void drain();
}
