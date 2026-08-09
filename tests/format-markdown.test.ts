import { describe, it, expect } from 'vitest';
import { linkify } from '../src/lib/format';

describe('linkify with markdown', () => {
	it('renders bold and italic', () => {
		const out = linkify('hello **world** and *cosmos*');
		expect(out).toContain('<strong>world</strong>');
		expect(out).toContain('<em>cosmos</em>');
	});

	it('renders inline code', () => {
		const out = linkify('try `npm install` first');
		expect(out).toContain('<code class="md-code">npm install</code>');
	});

	it('renders fenced code blocks unescaped further', () => {
		const out = linkify('```\nconst x = 1\n```');
		expect(out).toContain('<pre class="md-fence"><code>');
		expect(out).toContain('const x = 1');
	});

	it('renders strike-through', () => {
		const out = linkify('this is ~~wrong~~ now');
		expect(out).toContain('<del>wrong</del>');
	});

	it('renders bullet lists', () => {
		const out = linkify('- one\n- two\n- three');
		expect(out).toContain('<ul class="md-list">');
		expect(out).toContain('<li>one</li>');
		expect(out).toContain('<li>three</li>');
	});

	it('renders blockquotes', () => {
		const out = linkify('> a thought');
		expect(out).toContain('<blockquote class="md-quote">');
	});

	it('still escapes HTML before markdown', () => {
		const out = linkify('**<script>alert(1)</script>**');
		expect(out).not.toContain('<script>');
		expect(out).toContain('&lt;script&gt;');
		expect(out).toContain('<strong>');
	});

	it('still autolinks URLs and emails', () => {
		const out = linkify('see https://example.com and ping me at hi@example.com');
		expect(out).toContain('href="https://example.com"');
		expect(out).toContain('href="mailto:hi@example.com"');
	});

	it('preserves single newlines as <br/> on plain prose', () => {
		const out = linkify('line one\nline two\nline three');
		// Each plain line should carry its own <br/> so the user's typed
		// line breaks survive into the rendered bubble.
		expect(out).toContain('line one<br/>');
		expect(out).toContain('line two<br/>');
		expect(out).toContain('line three<br/>');
	});

	it('preserves blank lines (paragraph breaks)', () => {
		const out = linkify('paragraph one\n\nparagraph two');
		// A blank line becomes an empty `<br/>` which paints as a vertical
		// gap between the two paragraphs.
		expect(out).toContain('paragraph one<br/><br/>paragraph two<br/>');
	});

	it('does not inject extra whitespace between block elements', () => {
		// Bullet list followed by prose: no stray newlines should appear
		// between </ul> and the following text — the join must not add
		// whitespace that would render as a phantom gap.
		const out = linkify('- one\n- two\n\nafter the list');
		expect(out).toContain('</ul>');
		expect(out).not.toMatch(/<\/ul>\s+after the list/);
	});
});
