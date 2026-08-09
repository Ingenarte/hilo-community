/**
 * Mailer interface — abstraction over the actual SMTP transport.
 *
 * The queue worker (`mailQueue.ts`) talks to a `Mailer` instead of importing
 * Nodemailer directly. This is the OCP/DIP seam:
 *
 *   - Open/Closed:    add Postmark/SES/Mailgun by writing a new adapter,
 *                     without touching the queue worker.
 *   - DIP:            unit tests inject a `MemoryMailer` (below) instead of
 *                     opening a real SMTP connection.
 *
 * The interface is deliberately small. If a future transport needs richer
 * delivery (DKIM, message-id tagging, X-Mailer headers) we can grow the
 * payload type without breaking adapters because the field is optional.
 */

export type MailerAttachment = {
	filename: string;
	path: string;
	cid?: string;
	contentType?: string;
};

export type MailerMessage = {
	from: string;
	to: string;
	subject: string;
	text: string;
	html: string;
	attachments?: MailerAttachment[];
};

export interface Mailer {
	send(msg: MailerMessage): Promise<void>;
}

/** In-memory mailer used by tests + the optional "dry-run" mode. */
export class MemoryMailer implements Mailer {
	public readonly sent: MailerMessage[] = [];
	async send(msg: MailerMessage): Promise<void> {
		this.sent.push(msg);
	}
	clear(): void {
		this.sent.length = 0;
	}
}

/** Nodemailer-backed implementation, lazily instantiated. */
export class NodemailerMailer implements Mailer {
	private transporter: import('nodemailer').Transporter | null = null;
	constructor(
		private readonly opts: {
			host: string;
			port: number;
			secure: boolean;
			user: string;
			pass: string;
		}
	) {}

	private async getTransporter(): Promise<import('nodemailer').Transporter> {
		if (!this.transporter) {
			const nodemailer = (await import('nodemailer')).default;
			this.transporter = nodemailer.createTransport({
				host: this.opts.host,
				port: this.opts.port,
				secure: this.opts.secure,
				auth: { user: this.opts.user, pass: this.opts.pass }
			});
		}
		return this.transporter;
	}

	async send(msg: MailerMessage): Promise<void> {
		const t = await this.getTransporter();
		await t.sendMail({
			from: msg.from,
			to: msg.to,
			subject: msg.subject,
			text: msg.text,
			html: msg.html,
			attachments: msg.attachments
		});
	}
}

/**
 * Module-level singleton + injection seam.
 *
 * Production code reads `getMailer()`; tests can call `setMailer(mock)`.
 * We don't expose the Nodemailer instance directly — only the abstract type.
 */
let current: Mailer | null = null;

export function setMailer(m: Mailer): void {
	current = m;
}

export function getMailer(): Mailer {
	if (!current) {
		throw new Error('Mailer not initialised. Call setMailer() at boot.');
	}
	return current;
}
