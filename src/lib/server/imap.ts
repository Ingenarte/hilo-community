/**
 * Optional IMAP poller for inbound replies.
 *
 * Disabled unless `IMAP_HOST` is set in the environment. Polls the INBOX
 * for new RFC 5322 messages, looks up the matching ticket by parsing the
 * `In-Reply-To` / `References` headers (Hilo's outbound messages set
 * `Message-Id: <ticket-{id}-msg-{n}@<hostname>>`), and appends the body as
 * a new message in that ticket.
 *
 * Why no `imapflow` / `mailparser` dependency? Two reasons:
 *   1. The Hilo charter is "two runtime deps". Adding two more for an
 *      optional feature breaks that.
 *   2. We can speak enough IMAP to do this by hand. We parse only the
 *      subset of MIME we need (headers + plain-text body).
 *
 * Limitations (documented in the README):
 *   - No TLS upgrade: we connect over `imaps://` (SSL from the start). Set
 *     `IMAP_PORT=993` for Gmail / standard providers.
 *   - We only handle multipart/alternative with a `text/plain` part, or a
 *     bare `text/plain` payload. HTML-only emails are stored as-is.
 *   - Attachments in the inbound email are NOT parsed in this minimal
 *     implementation. Open a PR if you need them — the hook is wired
 *     through `ingestMessage()` below.
 */

import tls from 'node:tls';
import { db } from './db';
import { config } from './env';
import { log } from './logger';
import { appendMessage, getTicket } from './tickets';
import { TicketClosedError } from './tickets-messages';
import { enqueueTicketClosedNotice } from './welcome';

type ImapConfig = {
	host: string;
	port: number;
	user: string;
	pass: string;
	mailbox: string;
};

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function configFromEnv(): ImapConfig | null {
	const host = process.env.IMAP_HOST;
	if (!host) return null;
	return {
		host,
		port: Number(process.env.IMAP_PORT || 993),
		user: process.env.IMAP_USER || config.smtp.user,
		pass: process.env.IMAP_PASS || config.smtp.pass,
		mailbox: process.env.IMAP_MAILBOX || 'INBOX'
	};
}

const POLL_MS = Number(process.env.HILO_IMAP_POLL_MS || 60_000);

export function startImapPoller(): void {
	if (started) return;
	const cfg = configFromEnv();
	if (!cfg) return;
	started = true;
	const tick = async () => {
		try {
			await pollOnce(cfg);
		} catch (err) {
			log.warn('imap poll failed', { error: (err as Error).message });
		} finally {
			timer = setTimeout(tick, POLL_MS);
		}
	};
	timer = setTimeout(tick, 10_000);
	log.info('imap poller started', { host: cfg.host, mailbox: cfg.mailbox, poll_ms: POLL_MS });
}

export function stopImapPoller(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	started = false;
}

// ─── Minimal IMAP client ────────────────────────────────────────────────────
//
// We speak just enough of RFC 3501 to do LOGIN, SELECT, UID FETCH and LOGOUT.
// No IDLE, no APPEND, no CONDSTORE. Keeps the code 200 lines and dep-free.

type ImapResponse = { tag: string; status: 'OK' | 'NO' | 'BAD'; lines: string[] };

class ImapClient {
	private socket: tls.TLSSocket | null = null;
	private buffer = '';
	private nextTag = 1;
	private pending: Array<{
		tag: string;
		resolve: (r: ImapResponse) => void;
		reject: (e: Error) => void;
		lines: string[];
	}> = [];

	async connect(host: string, port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const sock = tls.connect({ host, port }, () => {
				this.socket = sock;
				sock.on('data', (chunk) => this.onData(chunk.toString('utf8')));
				sock.on('error', reject);
			});
			sock.once('error', reject);
			// Server greets us with "* OK ..." — wait for it.
			const greetTimer = setTimeout(() => reject(new Error('IMAP greeting timeout')), 10_000);
			sock.once('data', (data) => {
				clearTimeout(greetTimer);
				this.buffer += data.toString('utf8');
				this.flushBuffer();
				resolve();
			});
		});
	}

	private onData(chunk: string) {
		this.buffer += chunk;
		this.flushBuffer();
	}

	private flushBuffer() {
		let nl;
		while ((nl = this.buffer.indexOf('\r\n')) !== -1) {
			const line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 2);
			this.handleLine(line);
		}
	}

	private handleLine(line: string) {
		if (this.pending.length === 0) return; // unsolicited
		const current = this.pending[0];
		if (line.startsWith(current.tag + ' ')) {
			const rest = line.slice(current.tag.length + 1);
			const space = rest.indexOf(' ');
			const status = rest.slice(0, space) as 'OK' | 'NO' | 'BAD';
			const lines = current.lines;
			this.pending.shift();
			current.resolve({ tag: current.tag, status, lines });
		} else {
			current.lines.push(line);
		}
	}

	async cmd(text: string): Promise<ImapResponse> {
		if (!this.socket) throw new Error('IMAP not connected');
		const tag = 'A' + String(this.nextTag++).padStart(4, '0');
		const promise = new Promise<ImapResponse>((resolve, reject) => {
			this.pending.push({ tag, resolve, reject, lines: [] });
		});
		this.socket.write(`${tag} ${text}\r\n`);
		return promise;
	}

	close() {
		try {
			this.socket?.end();
		} catch {
			/* ignore */
		}
		this.socket = null;
	}
}

// ─── Polling cycle ──────────────────────────────────────────────────────────

async function pollOnce(cfg: ImapConfig) {
	const lastUid = (
		(db.prepare('SELECT last_uid FROM imap_state WHERE mailbox = ?').get(cfg.mailbox) as
			| { last_uid: number }
			| undefined) ?? { last_uid: 0 }
	).last_uid;

	const client = new ImapClient();
	try {
		await client.connect(cfg.host, cfg.port);
		const login = await client.cmd(`LOGIN "${esc(cfg.user)}" "${esc(cfg.pass)}"`);
		if (login.status !== 'OK') throw new Error('IMAP LOGIN failed');
		const select = await client.cmd(`SELECT "${cfg.mailbox}"`);
		if (select.status !== 'OK') throw new Error('IMAP SELECT failed');

		const search = await client.cmd(`UID SEARCH UID ${lastUid + 1}:*`);
		if (search.status !== 'OK') throw new Error('IMAP SEARCH failed');
		const uids = (
			search.lines
				.find((l) => l.startsWith('* SEARCH'))
				?.slice('* SEARCH'.length)
				.trim()
				.split(/\s+/)
				.filter(Boolean) ?? []
		)
			.map(Number)
			.filter((u) => u > lastUid);

		if (uids.length === 0) return;

		let highest = lastUid;
		for (const uid of uids) {
			try {
				const fetch = await client.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
				if (fetch.status !== 'OK') continue;
				const raw = extractLiteral(fetch.lines);
				if (raw) await ingestRaw(raw);
				highest = Math.max(highest, uid);
			} catch (err) {
				log.warn('imap fetch failed', { uid, error: (err as Error).message });
			}
		}

		db.prepare(
			`INSERT INTO imap_state (mailbox, last_uid, updated_at) VALUES (?, ?, unixepoch())
			 ON CONFLICT(mailbox) DO UPDATE SET last_uid = excluded.last_uid, updated_at = unixepoch()`
		).run(cfg.mailbox, highest);

		await client.cmd('LOGOUT');
	} finally {
		client.close();
	}
}

function esc(s: string): string {
	return s.replace(/(["\\])/g, '\\$1');
}

/**
 * UID FETCH replies look like:
 *   * 1 FETCH (UID 7 BODY[] {1234}
 *   <1234 bytes of raw RFC822>
 *   )
 *   A0003 OK Fetch completed.
 * We just collect everything between the `{<size>}` cue and the final `)`.
 */
function extractLiteral(lines: string[]): string | null {
	const idx = lines.findIndex((l) => /\{\d+\}/.test(l));
	if (idx === -1) return null;
	const rest = lines.slice(idx + 1);
	// Drop trailing `)` if present.
	if (rest.length && rest[rest.length - 1] === ')') rest.pop();
	return rest.join('\r\n');
}

// ─── RFC 5322 parsing (minimal) ─────────────────────────────────────────────

function splitHeaderBody(raw: string): { headers: Map<string, string>; body: string } {
	const sep = raw.indexOf('\r\n\r\n');
	const headerBlob = sep === -1 ? raw : raw.slice(0, sep);
	const body = sep === -1 ? '' : raw.slice(sep + 4);
	const headers = new Map<string, string>();
	// Fold continuation lines (start with whitespace) into the previous one.
	const folded = headerBlob.replace(/\r\n[\t ]+/g, ' ');
	for (const line of folded.split('\r\n')) {
		const colon = line.indexOf(':');
		if (colon === -1) continue;
		const k = line.slice(0, colon).trim().toLowerCase();
		const v = line.slice(colon + 1).trim();
		headers.set(k, v);
	}
	return { headers, body };
}

function findTicketIdFromHeaders(h: Map<string, string>): number | null {
	const candidates = [h.get('in-reply-to'), h.get('references'), h.get('message-id')]
		.filter(Boolean)
		.join(' ');
	const m = candidates.match(/<?ticket-(\d+)(?:-msg-\d+)?@/);
	if (m) return Number(m[1]);
	const subj = h.get('subject') ?? '';
	const sm = subj.match(/#(\d+)/); // fallback: subject "[Brand] #42 · Title"
	return sm ? Number(sm[1]) : null;
}

function extractFromEmail(value: string | undefined): string | null {
	if (!value) return null;
	const m = value.match(/<([^>]+)>/) || value.match(/([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+)/);
	return m ? m[1].toLowerCase() : null;
}

/**
 * Strip MIME multipart wrappers, return the text/plain body if present.
 * Falls back to the whole body. Decodes quoted-printable in a minimal way.
 */
function extractTextBody(headers: Map<string, string>, body: string): string {
	const ct = headers.get('content-type') ?? '';
	if (ct.startsWith('multipart/')) {
		const m = ct.match(/boundary="?([^";]+)"?/);
		const boundary = m?.[1];
		if (boundary) {
			const parts = body.split(`--${boundary}`);
			for (const p of parts) {
				const pp = splitHeaderBody(p.replace(/^\r?\n/, ''));
				const ptype = (pp.headers.get('content-type') ?? '').toLowerCase();
				if (ptype.startsWith('text/plain')) {
					return decodeContent(pp.headers, pp.body);
				}
			}
		}
	}
	return decodeContent(headers, body);
}

function decodeContent(headers: Map<string, string>, body: string): string {
	const enc = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
	let text = body;
	if (enc === 'quoted-printable') {
		text = text
			.replace(/=\r?\n/g, '')
			.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
				String.fromCharCode(parseInt(hex, 16))
			);
	} else if (enc === 'base64') {
		try {
			text = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
		} catch {
			/* leave as-is */
		}
	}
	return text;
}

/**
 * Strip the "On <date>, <person> wrote:" tail that most clients quote
 * when replying. Keeps replies tight.
 */
function trimQuotedReply(text: string): string {
	const lines = text.split('\n');
	const idx = lines.findIndex(
		(l) =>
			/^On .* wrote:\s*$/i.test(l.trim()) ||
			/^>+\s/.test(l.trim()) ||
			/^---+ ?Original message ?---+/i.test(l.trim())
	);
	return (idx === -1 ? lines : lines.slice(0, idx)).join('\n').trim();
}

async function ingestRaw(raw: string) {
	const { headers, body } = splitHeaderBody(raw);
	const ticketId = findTicketIdFromHeaders(headers);
	if (!ticketId) {
		log.debug('imap: no ticket id matched', { subject: headers.get('subject') });
		return;
	}
	const ticket = getTicket(ticketId);
	if (!ticket) {
		log.debug('imap: ticket no longer exists', { ticket_id: ticketId });
		return;
	}
	const from = extractFromEmail(headers.get('from'));
	if (!from) return;
	// Find or refuse: only the ticket owner OR an admin may reply by email.
	const user = db
		.prepare('SELECT id, email, role FROM users WHERE email = ?')
		.get(from) as { id: number; email: string; role: 'user' | 'admin' } | undefined;
	if (!user) {
		log.debug('imap: from address not a known user, skipping', { from });
		return;
	}
	if (user.role !== 'admin' && user.id !== ticket.user_id) {
		log.warn('imap: rejecting reply from non-owner non-admin', {
			from,
			ticket_id: ticketId
		});
		return;
	}
	const bodyText = trimQuotedReply(extractTextBody(headers, body));
	if (!bodyText) return;
	try {
		ingestMessage({
			ticketId,
			senderId: user.id,
			senderRole: user.role,
			body: bodyText
		});
	} catch (err) {
		if (err instanceof TicketClosedError) {
			// Users cannot write in closed tickets: say so instead of dropping it silently.
			enqueueTicketClosedNotice({
				userId: user.id,
				toEmail: user.email,
				ticketId,
				title: ticket.title
			});
			log.info('imap: reply to a closed ticket refused', { ticket_id: ticketId, from });
			return;
		}
		throw err;
	}
	log.info('imap: ingested reply', { ticket_id: ticketId, from });
}

function ingestMessage(args: {
	ticketId: number;
	senderId: number;
	senderRole: 'user' | 'admin';
	body: string;
}) {
	appendMessage(args);
}
