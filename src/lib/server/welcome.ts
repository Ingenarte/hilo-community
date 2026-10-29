import { db } from './db';
import { config } from './env';

// Emails carry a one-time link to choose a password, never a password itself.

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function enqueue(userId: number, toEmail: string, subject: string, text: string, html: string) {
	db.prepare(
		`INSERT INTO email_outbox (user_id, to_email, subject, text_body, html_body, send_after)
		 VALUES (?, ?, ?, ?, ?, unixepoch())`
	).run(userId, toEmail, subject, text, html);
}

function validFor(ttlSeconds: number): string {
	const hours = Math.round(ttlSeconds / 3600);
	return hours >= 48 ? `${Math.round(hours / 24)} days` : hours === 1 ? '1 hour' : `${hours} hours`;
}

type LinkArgs = {
	toEmail: string;
	userId: number;
	/** One-time link from `passwordLinkUrl`. */
	setPasswordUrl: string;
	/** Seconds the link stays valid, shown in the email. */
	ttlSeconds: number;
};

export async function enqueueWelcomeEmail(args: LinkArgs & { role: 'user' | 'admin' }): Promise<void> {
	const brand = config.brand;
	const admin = args.role === 'admin' ? ' (as administrator)' : '';
	const loginUrl = `${config.publicBaseUrl.replace(/\/+$/, '')}/login`;
	const valid = validFor(args.ttlSeconds);
	const text = [
		`Hi,`,
		``,
		`An account has been created for you on ${brand}${admin}.`,
		`Choose your password to get started (the link works once and is valid for ${valid}):`,
		``,
		args.setPasswordUrl,
		``,
		`Afterwards you can sign in at ${loginUrl} with ${args.toEmail}.`,
		``,
		brand
	].join('\n');
	const html = layout(
		brand,
		`<p>Hi,</p>
<p>An account has been created for you on <strong>${esc(brand)}</strong>${admin}.</p>
<p>Choose your password to get started. The link works once and is valid for ${valid}.</p>
${button(args.setPasswordUrl, 'Choose my password')}
<p style="color:#71717a;font-size:13px;">Afterwards, sign in at <a href="${esc(loginUrl)}">${esc(loginUrl)}</a> with ${esc(args.toEmail)}.</p>`
	);
	enqueue(args.userId, args.toEmail, `Welcome to ${brand}: choose your password`, text, html);
}

export async function enqueueResetPasswordEmail(
	args: LinkArgs & { initiatedBy: 'admin' | 'self' }
): Promise<void> {
	const brand = config.brand;
	const valid = validFor(args.ttlSeconds);
	const why =
		args.initiatedBy === 'admin'
			? `An administrator reset your password on ${brand}. Your previous password no longer works.`
			: `We received a request to reset your password on ${brand}. Your current password keeps working until you choose a new one.`;
	const text = [
		`Hi,`,
		``,
		why,
		`Choose a new password (the link works once and is valid for ${valid}):`,
		``,
		args.setPasswordUrl,
		``,
		args.initiatedBy === 'admin'
			? `If you were not expecting this, contact your administrator.`
			: `If you did not request this, you can ignore this email.`,
		``,
		brand
	].join('\n');
	const html = layout(
		brand,
		`<p>Hi,</p>
<p>${esc(why)}</p>
<p>Choose a new password. The link works once and is valid for ${valid}.</p>
${button(args.setPasswordUrl, 'Choose a new password')}
<p style="color:#71717a;font-size:13px;">${
			args.initiatedBy === 'admin'
				? 'If you were not expecting this, contact your administrator.'
				: 'If you did not request this, you can ignore this email.'
		}</p>`
	);
	enqueue(args.userId, args.toEmail, `Choose a new password for ${brand}`, text, html);
}

function button(url: string, label: string): string {
	return `<p style="margin:20px 0;"><a href="${esc(url)}" style="background:#6d4aff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;">${esc(label)}</a></p>
<p style="color:#71717a;font-size:12px;word-break:break-all;">Or paste this address into your browser:<br>${esc(url)}</p>`;
}

function layout(brand: string, inner: string): string {
	return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;max-width:560px;margin:0 auto;padding:24px;">
${inner}
<p style="color:#71717a;margin-top:32px;">${esc(brand)}</p>
</body></html>`;
}

/**
 * A user replied by email to a closed ticket: the reply is not added, so tell
 * them why and how to continue. At most one notice per person and ticket per day.
 */
export function enqueueTicketClosedNotice(args: {
	userId: number;
	toEmail: string;
	ticketId: number;
	title: string;
}): boolean {
	const brand = config.brand;
	const subject = `${brand}: ticket #${args.ticketId} is closed`;
	const recent = db
		.prepare(
			'SELECT 1 FROM email_outbox WHERE user_id = ? AND subject = ? AND send_after > unixepoch() - 86400'
		)
		.get(args.userId, subject);
	if (recent) return false;
	const newUrl = `${config.publicBaseUrl.replace(/\/+$/, '')}/tickets/new`;
	const text = [
		`Hi,`,
		``,
		`Your reply to "${args.title}" was not added because the ticket is closed.`,
		`If you need something else, please open a new ticket:`,
		``,
		newUrl,
		``,
		`Only an administrator can reopen a closed ticket.`,
		``,
		brand
	].join('\n');
	const html = layout(
		brand,
		`<p>Hi,</p>
<p>Your reply to <strong>${esc(args.title)}</strong> was not added because the ticket is closed.</p>
<p>If you need something else, please open a new ticket.</p>
${button(newUrl, 'Open a new ticket')}
<p style="color:#71717a;font-size:13px;">Only an administrator can reopen a closed ticket.</p>`
	);
	enqueue(args.userId, args.toEmail, subject, text, html);
	return true;
}
