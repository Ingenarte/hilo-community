import { db } from './db';
import { config } from './env';

type EnqueueArgs = {
	toEmail: string;
	userId: number;
	generatedPassword: string;
	role: 'user' | 'admin';
};

export async function enqueueWelcomeEmail(args: EnqueueArgs): Promise<void> {
	const loginUrl = `${config.publicBaseUrl.replace(/\/+$/, '')}/login`;
	const subject = `Welcome to ${config.brand} — your account is ready`;

	const vars = {
		email: args.toEmail,
		password: args.generatedPassword,
		loginUrl,
		role: args.role,
		brand: config.brand
	};

	db.prepare(
		`INSERT INTO email_outbox (user_id, to_email, subject, text_body, html_body, send_after)
		 VALUES (?, ?, ?, ?, ?, unixepoch())`
	).run(args.userId, args.toEmail, subject, renderText(vars), renderHtml(vars));
}

type RenderVars = {
	email: string;
	password: string;
	loginUrl: string;
	role: string;
	brand: string;
};

function renderText(v: RenderVars): string {
	return [
		`Hi,`,
		``,
		`An account has been created for you on ${v.brand}${v.role === 'admin' ? ' (as administrator)' : ''}.`,
		``,
		`  Login URL:   ${v.loginUrl}`,
		`  Email:       ${v.email}`,
		`  Password:    ${v.password}`,
		``,
		`Keep your password safe. You can change it later from your preferences.`,
		``,
		`— ${v.brand}`
	].join('\n');
}

function renderHtml(v: RenderVars): string {
	const code = (s: string) =>
		`<code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:ui-monospace,Menlo,monospace;">${s}</code>`;
	return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;max-width:560px;margin:0 auto;padding:24px;">
<p>Hi,</p>
<p>An account has been created for you on <strong>${v.brand}</strong>${v.role === 'admin' ? ' (as administrator)' : ''}.</p>
<table cellpadding="6" style="border-collapse:collapse;margin:16px 0;">
  <tr><td style="color:#71717a;">Login URL</td><td><a href="${v.loginUrl}">${v.loginUrl}</a></td></tr>
  <tr><td style="color:#71717a;">Email</td><td>${code(v.email)}</td></tr>
  <tr><td style="color:#71717a;">Password</td><td>${code(v.password)}</td></tr>
</table>
<p>Keep your password safe. You can change it later from your preferences.</p>
<p style="color:#71717a;margin-top:32px;">— ${v.brand}</p>
</body></html>`;
}
