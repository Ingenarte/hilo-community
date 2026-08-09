/**
 * Lightweight client-side message formatter.
 *
 * Deliberately tiny subset of markdown so chat bodies stay readable
 * without pulling in a full markdown lib. Supports:
 *
 *   - Headings 1–3 (`# `, `## `, `### `)
 *   - Bold (`**…**`), italic (`*…*`), strike (`~~…~~`)
 *   - Inline code (`` `code` ``) + fenced code blocks (` ``` `)
 *   - Bullet lists (`- `) + task lists (`- [ ]` / `- [x]`)
 *   - Blockquotes (`> `)
 *   - Markdown links `[text](url)` + auto-link of bare URLs/emails
 *   - Markdown images `![alt](url)` — only when src is http(s) or data:
 *   - Pipe tables (GitHub-flavoured)
 *
 * Everything is HTML-escaped *before* any transformation, so the input is
 * XSS-safe even when the user pastes raw HTML. Whitespace is preserved via
 * `white-space: pre-wrap` at the call site.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Auto-link bare URLs and emails. Operates over already-escaped HTML.
 */
function autolink(s: string): string {
	return s
		.replace(URL_RE, (url) => {
			const href = url.startsWith('http') ? url : `https://${url}`;
			return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="link">${url}</a>`;
		})
		.replace(EMAIL_RE, (email) => `<a href="mailto:${email}" class="link">${email}</a>`);
}

/**
 * Whether a URL is safe to emit unescaped as `href` / `src`. Blocks
 * `javascript:`, `data:` (except data:image when used as <img>) and any
 * scheme we don't explicitly recognise.
 */
function safeHref(url: string): string | null {
	const trimmed = url.trim();
	if (/^(https?:|mailto:|tel:|\/|#)/i.test(trimmed)) return trimmed;
	return null;
}
function safeImgSrc(url: string): string | null {
	const trimmed = url.trim();
	if (/^(https?:|data:image\/[a-z]+;base64,)/i.test(trimmed)) return trimmed;
	return null;
}

/**
 * Per-line: headings, lists (incl. task lists), blockquotes, tables.
 * Implemented as a tiny state machine because contiguous lines need a
 * single wrapping element.
 */
function wrapLineGroups(text: string): string {
	const lines = text.split('\n');
	const out: string[] = [];
	let inList = false;
	let inQuote = false;
	let tableBuf: string[] | null = null;

	const closeAll = () => {
		if (inList) {
			out.push('</ul>');
			inList = false;
		}
		if (inQuote) {
			out.push('</blockquote>');
			inQuote = false;
		}
		if (tableBuf) {
			out.push(renderTable(tableBuf));
			tableBuf = null;
		}
	};

	for (const line of lines) {
		const headingMatch = /^[\s]*(#{1,3})\s+(.+)$/.exec(line);
		const bulletMatch = /^[\s]*[-*]\s+(.+)$/.exec(line);
		const quoteMatch = /^[\s]*(?:>|&gt;)\s?(.*)$/.exec(line);
		const tableLine = /^\s*\|.*\|\s*$/.test(line);

		if (tableLine) {
			if (!tableBuf) tableBuf = [];
			tableBuf.push(line);
			continue;
		}

		if (headingMatch) {
			closeAll();
			const level = headingMatch[1].length;
			out.push(`<h${level} class="md-h md-h${level}">${headingMatch[2]}</h${level}>`);
		} else if (bulletMatch) {
			if (!inList) {
				closeAll();
				out.push('<ul class="md-list">');
				inList = true;
			}
			// Task-list checkbox: `[ ]` or `[x]`
			const item = bulletMatch[1];
			const task = /^\[(\s|x|X)\]\s+(.+)$/.exec(item);
			if (task) {
				const checked = task[1].toLowerCase() === 'x';
				out.push(
					`<li class="md-task"><input type="checkbox" disabled${
						checked ? ' checked' : ''
					}/><span>${task[2]}</span></li>`
				);
			} else {
				out.push(`<li>${item}</li>`);
			}
		} else if (quoteMatch) {
			if (!inQuote) {
				closeAll();
				out.push('<blockquote class="md-quote">');
				inQuote = true;
			}
			out.push(quoteMatch[1]);
			out.push('<br/>');
		} else {
			closeAll();
			// Plain text line. Append `<br/>` so the line break the user typed
			// survives into the rendered HTML. Without this every newline
			// collapses to whitespace and the bubble shows one continuous
			// paragraph regardless of the source formatting. Blank lines
			// become an empty `<br/>` which paints as a vertical gap —
			// matching the intuition of double-Enter = paragraph break.
			out.push(line + '<br/>');
		}
	}
	closeAll();
	// Join with empty string. Plain lines already carry their own `<br/>`;
	// block elements (`<ul>`, `<blockquote>`, `<h2>`…) do their own line
	// handling at the browser level, so we must NOT inject any extra
	// whitespace between them or the layout grows phantom gaps.
	return out.join('');
}

/**
 * Render a GitHub-flavoured pipe table. The buffer is a list of contiguous
 * `| … |` lines. We require the second line to be the separator
 * (`|---|---|`).
 */
function renderTable(lines: string[]): string {
	if (lines.length < 2) return lines.join('\n');
	const splitRow = (l: string) =>
		l
			.replace(/^\s*\||\|\s*$/g, '')
			.split('|')
			.map((c) => c.trim());

	const header = splitRow(lines[0]);
	const sep = splitRow(lines[1]);
	const isSep = sep.every((c) => /^:?-{2,}:?$/.test(c));
	if (!isSep) return lines.join('\n');

	const align: ('l' | 'c' | 'r')[] = sep.map((c) => {
		if (/^:-+:$/.test(c)) return 'c';
		if (/^-+:$/.test(c)) return 'r';
		return 'l';
	});

	const body = lines.slice(2).map(splitRow);

	const headHtml = header
		.map(
			(h, i) =>
				`<th class="md-td md-${align[i] ?? 'l'}">${h}</th>`
		)
		.join('');
	const bodyHtml = body
		.map(
			(row) =>
				`<tr>${row
					.map((c, i) => `<td class="md-td md-${align[i] ?? 'l'}">${c}</td>`)
					.join('')}</tr>`
		)
		.join('');
	return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

/**
 * Inline pass: code, images, links, bold/italic/strike. Order matters:
 * - inline code first (its content shouldn't be hit by anything below)
 * - images (`![]()`) before links (`[]()`) — image syntax is a superset
 * - markdown links before bold/italic (so `[**x**](url)` works)
 */
function inlineMarkup(s: string): string {
	const codes: string[] = [];
	s = s.replace(/`([^`]+)`/g, (_, code: string) => {
		codes.push(code);
		return ` CODE${codes.length - 1} `;
	});

	s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (full, alt: string, src: string) => {
		const safe = safeImgSrc(src);
		if (!safe) return full;
		return `<img src="${safe}" alt="${alt}" class="md-img" loading="lazy" />`;
	});

	s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (full, text: string, href: string) => {
		const safe = safeHref(href);
		if (!safe) return full;
		const isExternal = /^https?:/i.test(safe);
		const attrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
		return `<a href="${safe}" class="link"${attrs}>${text}</a>`;
	});

	s = s
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
		.replace(/~~([^~]+)~~/g, '<del>$1</del>');

	s = s.replace(/ CODE(\d+) /g, (_, i) => `<code class="md-code">${codes[Number(i)]}</code>`);
	return s;
}

/**
 * Render a chat message body to safe HTML.
 */
export function linkify(body: string): string {
	const fences: string[] = [];
	let work = escapeHtml(body);
	work = work.replace(/```([\s\S]*?)```/g, (_, code: string) => {
		fences.push(code.replace(/^\n/, ''));
		return ` FENCE${fences.length - 1} `;
	});
	work = wrapLineGroups(work);
	work = inlineMarkup(work);
	work = autolink(work);
	work = work.replace(
		/ FENCE(\d+) /g,
		(_, i) => `<pre class="md-fence"><code>${fences[Number(i)]}</code></pre>`
	);
	return work;
}

/* ----------------------------------------------------------------------
 * Date / size helpers — consolidated from 6+ duplicated copies across
 * src/routes/**. Re-export here so every component imports from one place.
 * -------------------------------------------------------------------- */

export function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Compact bubble timestamp: HH:MM if today, else "Oct 25 HH:MM". */
export function shortTime(unix: number): string {
	const d = new Date(unix * 1000);
	const today = new Date();
	const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	if (d.toDateString() === today.toDateString()) return time;
	return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

/** Friendly side-panel date: "Today, HH:MM" / "Yesterday, HH:MM" / "25 Oct 26, HH:MM". */
export function niceDate(unix: number): string {
	const d = new Date(unix * 1000);
	const now = new Date();
	const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const days = Math.floor((startOf(now) - startOf(d)) / 86_400_000);
	if (days === 0) return `Today, ${time}`;
	if (days === 1) return `Yesterday, ${time}`;
	const dd = String(d.getDate()).padStart(2, '0');
	const month = d.toLocaleDateString([], { month: 'short' });
	const yy = String(d.getFullYear() % 100).padStart(2, '0');
	return `${dd} ${month} ${yy}, ${time}`;
}

/** Relative time for inbox cards: "just now" / "5m ago" / "2h ago" / "yesterday" / "5d ago". */
export function timeAgo(unix: number): string {
	const diff = Math.max(0, Math.floor(Date.now() / 1000 - unix));
	if (diff < 60) return 'just now';
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	if (diff < 172800) return 'yesterday';
	return `${Math.floor(diff / 86400)}d ago`;
}
