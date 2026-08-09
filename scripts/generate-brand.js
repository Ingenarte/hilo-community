#!/usr/bin/env node
/**
 * Hilo · brand asset generator.
 *
 * Generates logos / favicon / OG card / hero artwork via OpenAI Images
 * (`gpt-image-1`) and (optionally) asks Claude to rank them against the
 * brand criteria from BRAND.md.
 *
 * Requires:
 *   OPENAI_API_KEY    (mandatory)
 *   ANTHROPIC_API_KEY (optional — enables the critique pass)
 *
 * Usage:
 *   node scripts/generate-brand.js                # full sweep
 *   node scripts/generate-brand.js logo           # just the logo prompts
 *   node scripts/generate-brand.js og             # just the OG card
 *   node scripts/generate-brand.js critique-only  # re-rank existing assets
 *
 * Outputs land under `static/brand/`. The current pick is symlinked to
 * `static/logo.png`, `static/og-card.png`, etc.
 */

import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_DIR = join(ROOT, 'static', 'brand');
await mkdir(BRAND_DIR, { recursive: true });

// ─── env (load nearest .env we can find) ────────────────────────────────────
async function loadEnv() {
	// Reads the repo .env; an alternative file can be supplied via HILO_ENV_FILE.
	const candidates = [join(ROOT, '.env'), process.env.HILO_ENV_FILE].filter(Boolean);
	for (const p of candidates) {
		if (!existsSync(p)) continue;
		const text = await readFile(p, 'utf8');
		for (const line of text.split('\n')) {
			const l = line.trim();
			if (!l || l.startsWith('#')) continue;
			const i = l.indexOf('=');
			if (i < 0) continue;
			const k = l.slice(0, i).trim();
			let v = l.slice(i + 1).trim();
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
				v = v.slice(1, -1);
			}
			if (!process.env[k]) process.env[k] = v;
		}
	}
}
await loadEnv();

if (!process.env.OPENAI_API_KEY) {
	console.error('OPENAI_API_KEY missing. Set it in .env and retry.');
	process.exit(1);
}

// ─── Prompts ────────────────────────────────────────────────────────────────

const PROMPTS = {
	'logo-v1': {
		size: '1024x1024',
		prompt: `A minimalist tech-startup logo for "Hilo", a self-hosted feedback &
support service. The mark is a single continuous thread that loops into
the lowercase letter "h" and trails off as a horizontal stroke,
suggesting a conversation thread. Two-color gradient from violet
(#a78bfa) to cyan (#67e8f9) at 135 degrees. Flat vector style, no
shadows, no extra gradients beyond the two-stop gradient on the stroke.
Soft rounded caps. Centred on a dark navy background (#0b0f1a). Crisp,
production-ready, large negative space, no wordmark below the mark.`
	},
	'logo-v2': {
		size: '1024x1024',
		prompt: `Logo for "Hilo", a tiny, friendly, open-source ticketing service.
Single soft thread tied into a small knot that, from a distance, reads
as a lowercase letter "h" silhouette. Only two strokes: an outer
violet-to-cyan gradient (#a78bfa to #67e8f9, 135 degrees) on the
thread, with deep navy (#0b0f1a) shadow accents inside. No bevel, no
glow. Centred on a 1024x1024 dark navy canvas (#0b0f1a). Pure mark
only — no wordmark.`
	},
	'logo-v3': {
		size: '1024x1024',
		prompt: `A 32x32 favicon for "Hilo" feedback service, scaled to 1024x1024 for
high-res. Solid rounded square (corner radius ~18%) with a violet-to-cyan
diagonal gradient (#a78bfa top-left to #67e8f9 bottom-right). Centred on
top: three horizontal soft-cap strokes, varying widths (long, medium,
short), the shortest on the bottom, all in deep navy (#0b0f1a). The
strokes evoke a chat thread / lines of text. No outline, no border, no
text. Background outside the rounded square is transparent.`
	},
	'og-card': {
		size: '1536x1024',
		prompt: `OpenGraph share card for "Hilo", a minimalist open-source feedback &
support tool. 1792x1024 wide. Dark background (#0b0f1a) with subtle
diffuse violet (#a78bfa) and cyan (#67e8f9) glow orbs in the corners
(opacity ~30%). Centred composition: on the left, a clean rounded
square mark with a violet-to-cyan gradient and three horizontal navy
strokes inside (evoking a chat thread). On the right, large lowercase
white sans-serif wordmark "hilo" with a slim cyan underline that loops
into a small thread tail. Below the wordmark, smaller muted-grey
tagline: "feedback & support, simply." No other text. Generous
breathing room. Glassmorphic feel.`
	},
	'hero-dark': {
		size: '1536x1024',
		prompt: `Hero artwork for the README of "Hilo", a self-hosted feedback +
support microservice. 1792x1024, landscape. Dark theme: deep navy
background (#0b0f1a) with multiple soft drifting blob gradients in
violet (#a78bfa) and cyan (#67e8f9), heavily blurred (~50px),
overlapping to suggest depth. A single thin glowing thread / curve in
the same gradient gracefully sweeps across the canvas left to right,
tying multiple "knots" along the way that abstractly evoke conversation
nodes. No text, no logo, no UI screenshots — pure abstract brand
artwork. Glassmorphic feel, premium tech aesthetic.`
	}
};

// ─── OpenAI image call ──────────────────────────────────────────────────────

async function generateImage(name, prompt, size) {
	console.log(`[${name}] generating (${size})…`);
	const res = await fetch('https://api.openai.com/v1/images/generations', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: 'gpt-image-1',
			prompt,
			size,
			n: 1,
			background: name === 'logo-v3' ? 'transparent' : 'opaque',
			quality: 'high'
		})
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 400)}`);
	}
	const data = await res.json();
	const item = data.data?.[0];
	if (!item) throw new Error('OpenAI returned no image');

	let buf;
	if (item.b64_json) {
		buf = Buffer.from(item.b64_json, 'base64');
	} else if (item.url) {
		const fetched = await fetch(item.url);
		buf = Buffer.from(await fetched.arrayBuffer());
	} else {
		throw new Error('OpenAI response has no b64_json or url');
	}
	const out = join(BRAND_DIR, `${name}.png`);
	await writeFile(out, buf);
	const kb = (buf.length / 1024).toFixed(0);
	console.log(`[${name}] saved → ${out} (${kb} KB)`);
	return out;
}

// ─── Claude critique (optional) ─────────────────────────────────────────────

async function critique(filePaths) {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.log('(skipping critique — ANTHROPIC_API_KEY not set)');
		return null;
	}
	console.log('\n[critique] asking Claude to rank the logo candidates…');
	const content = [
		{
			type: 'text',
			text: `You are reviewing logo candidates for "Hilo", a self-hosted ticket+chat microservice. Charter: small, self-hosted, SQLite-only, MIT. Brand voice: quiet confidence, lowercase, no hype.

Brand criteria (from BRAND.md):
- Renders crisply at 16px (favicon) without losing detail
- Works on both dark (#0b0f1a) and light (#f5f7fb) backgrounds
- Two-stop gradient max (violet #a78bfa → cyan #67e8f9)
- NO chat-bubble cliché
- Memorable / unique / brandable

Rank the candidates 1..N from best to worst, with one line of justification per rank. Then recommend a winner with concrete next steps (vectorise / which size to use / what to fix).
Keep the whole response under 400 words.`
		}
	];
	for (const p of filePaths) {
		try {
			const buf = await readFile(p);
			content.push({
				type: 'image',
				source: { type: 'base64', media_type: 'image/png', data: buf.toString('base64') }
			});
			content.push({ type: 'text', text: `^ candidate: ${p.split('/').pop()}` });
		} catch {
			/* skip missing */
		}
	}

	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'x-api-key': process.env.ANTHROPIC_API_KEY,
			'anthropic-version': '2023-06-01',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: 'claude-opus-4-5',
			max_tokens: 1500,
			messages: [{ role: 'user', content }]
		})
	});
	if (!res.ok) {
		console.warn('[critique] Anthropic call failed:', res.status, await res.text());
		return null;
	}
	const data = await res.json();
	const text = data.content?.[0]?.text ?? '(no text)';
	const out = join(BRAND_DIR, 'CRITIQUE.md');
	await writeFile(out, `# Brand candidates · Claude critique\n\n${text}\n`);
	console.log(`[critique] written → ${out}\n`);
	console.log(text);
	return text;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
	const arg = process.argv[2];
	let targets;
	if (!arg || arg === 'all') {
		targets = Object.keys(PROMPTS);
	} else if (arg === 'logo') {
		targets = ['logo-v1', 'logo-v2', 'logo-v3'];
	} else if (arg === 'og') {
		targets = ['og-card'];
	} else if (arg === 'hero') {
		targets = ['hero-dark'];
	} else if (arg === 'critique-only') {
		targets = [];
	} else if (PROMPTS[arg]) {
		targets = [arg];
	} else {
		console.error(`Unknown target: ${arg}. Try: all | logo | og | hero | <name> | critique-only`);
		process.exit(1);
	}

	const generated = [];
	for (const name of targets) {
		const p = PROMPTS[name];
		try {
			const out = await generateImage(name, p.prompt, p.size);
			generated.push(out);
		} catch (err) {
			console.error(`[${name}] FAILED:`, err.message);
		}
	}

	// Always re-critique whatever logo PNGs are present in BRAND_DIR.
	const existing = (await readdir(BRAND_DIR))
		.filter((f) => /^logo-/.test(f) && f.endsWith('.png'))
		.map((f) => join(BRAND_DIR, f))
		.sort();
	if (existing.length > 0) {
		await critique(existing);
	}

	console.log('\nDone.');
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
