import { describe, it, expect } from 'vitest';
import { linkify } from '../src/lib/format';

describe('linkify', () => {
	it('escapes HTML before linkifying', () => {
		// Plain prose lines carry a trailing `<br/>` so the user's typed
		// line breaks survive into the rendered bubble.
		expect(linkify('<script>alert(1)</script>')).toBe(
			'&lt;script&gt;alert(1)&lt;/script&gt;<br/>'
		);
	});

	it('linkifies https URLs', () => {
		const out = linkify('see https://example.com/page for details');
		expect(out).toContain('href="https://example.com/page"');
		expect(out).toContain('target="_blank"');
		expect(out).toContain('rel="noopener noreferrer"');
	});

	it('linkifies bare www URLs with https prefix', () => {
		const out = linkify('go to www.example.com now');
		expect(out).toContain('href="https://www.example.com"');
	});

	it('linkifies emails as mailto', () => {
		const out = linkify('reach me at hi@example.com');
		expect(out).toContain('href="mailto:hi@example.com"');
	});

	it('strips trailing punctuation from URLs', () => {
		const out = linkify('check https://example.com/path. Cool!');
		// `.` after the URL should NOT be part of the link
		expect(out).toContain('href="https://example.com/path"');
		expect(out).not.toContain('href="https://example.com/path."');
	});

	it('does not double-linkify HTML-like inputs', () => {
		// Even something that looks like an <a> tag should be escaped first.
		const out = linkify('<a href="https://example.com">x</a>');
		expect(out).toMatch(/^&lt;a/);
	});
});
