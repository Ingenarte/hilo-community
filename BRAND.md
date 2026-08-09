# Hilo — Brand & Asset Guide

> Prompts, palette, and generation recipes for producing Hilo's logo,
> social cards, and email-header artwork. The defaults below match the
> live UI (`src/app.css` brand tokens).

## Current assets

The live assets were generated with `scripts/generate-brand.js` against
OpenAI `gpt-image-1` and ranked by Claude Opus. Re-generate with:

```bash
node scripts/generate-brand.js          # full sweep (logo + og + hero)
node scripts/generate-brand.js logo     # just the 3 logo variations
node scripts/generate-brand.js og       # just the OG card
```

The winning logo and the OG / hero artwork were copied into `static/`:

| File | Use |
|---|---|
| `static/favicon.svg` | Hand-drawn vector approximation of the mark (crisp at favicon sizes) |
| `static/logo.png` (1024) | Master raster |
| `static/logo-512.png` / `-256.png` / `-192.png` | PWA + apple-touch-icon |
| `static/favicon-32.png` | PNG favicon fallback for older browsers |
| `static/og-card.png` (1536×1024) | OpenGraph + Twitter share card |
| `static/hero-dark.png` (1536×1024) | README hero artwork |
| `static/brand/logo-v1.png`, `logo-v2.png`, `logo-v3.png` | All candidates kept for re-pick |
| `static/brand/CRITIQUE.md` | Claude's ranking + rationale |

To re-rank existing candidates without re-spending OpenAI credits:

```bash
node scripts/generate-brand.js critique-only
```

To replace the SVG favicon with a hand-traced vector of `logo.png` you
can use Recraft/vectorizer.ai or `potrace` locally (`brew install
potrace`); see the "Iteration checklist" at the bottom of this file.

---

## 1. Palette (matches `src/app.css`)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--color-bg-deep` | `oklch(0.18 0.04 270)` ≈ `#0b0f1a` | `oklch(0.97 0.01 270)` ≈ `#f5f7fb` | Page background |
| `--color-text` | `oklch(0.97 0.02 270)` ≈ `#e6e7eb` | `oklch(0.18 0.04 270)` ≈ `#0b0f1a` | Body text |
| `--color-accent` | `oklch(0.74 0.18 295)` ≈ `#a78bfa` (violet) | `oklch(0.55 0.2 295)` ≈ `#7c3aed` | Primary accent |
| `--color-accent-2` | `oklch(0.78 0.16 200)` ≈ `#67e8f9` (cyan) | `oklch(0.6 0.16 200)` ≈ `#0891b2` | Secondary accent / gradient end |

The primary gradient (used in the favicon, buttons, share cards) goes
`accent → accent-2` at a 135° angle.

### Auxiliary accents

The user-selectable accent palette is the same four hues:

- `violet` (default): `#a78bfa → #67e8f9`
- `cyan`: `#67e8f9 → #5eead4`
- `emerald`: `#34d399 → #a7f3d0`
- `amber`: `#fbbf24 → #f87171`

---

## 2. Logo prompts

The name **"Hilo"** literally means "thread" in Spanish — every prompt
below leans on that concept (a thread, a strand, a knot, a continuous
line) without resorting to the cliché chat-bubble icon.

### Prompt v1 — minimalist mark

```
A minimalist tech-startup logo for "Hilo", a self-hosted feedback &
support service. The mark is a single continuous thread that loops into
the lowercase letter "h" and trails off as a horizontal stroke,
suggesting a conversation thread. Two-color gradient from violet
(#a78bfa) to cyan (#67e8f9) at 135°. Flat vector, no shadows, no
gradients beyond the two-stop gradient on the stroke. Soft rounded
caps. Centred on a 1024×1024 transparent background. Clean modern
sans-serif wordmark "hilo" set in geometric sans (think Inter
Display), lowercase, optical kerning, positioned to the right of the
mark with the same vertical centre. Production-ready SVG.
```

### Prompt v2 — playful knot

```
Logo for "Hilo" — a tiny, friendly, open-source ticketing service.
The mark is a knot tied from a single soft thread, abstract and
geometric (think Celtic knot meets ribbon), forming a stylised letter
"h" silhouette when squinted at. Use only two strokes: an outer
violet→cyan gradient (#a78bfa to #67e8f9, 135°) on the thread, and
a darker navy (#0b0f1a) for depth shadows. No bevel, no glow. The
mark sits inside an invisible 512×512 square; safe area 64 px. Pair
with the lowercase wordmark "hilo" in a humanist sans, slightly
condensed, set in the same violet. Output: SVG with named layers
(mark, wordmark, exclusion zone).
```

### Prompt v3 — favicon-first

```
A 32×32 favicon for "Hilo" feedback service. Solid rounded square
with a violet→cyan diagonal gradient (#a78bfa top-left to #67e8f9
bottom-right). Centred on top: three horizontal soft-cap strokes,
varying widths (long, medium, short), the shortest on the bottom,
all in deep navy (#0b0f1a). The strokes evoke a chat thread / lines
of text. No outline, no border. Crisp at 32 px and scalable to 512.
SVG, no embedded raster. Provide a 512 px export plus a
monochrome black-on-transparent variant for inverse contexts.
```

### Prompt v4 — wordmark only (no icon)

```
A lowercase wordmark for "hilo", an open-source self-hosted ticket
service. Geometric sans-serif (à la Söhne, Inter Display, or GT America),
custom letterforms: the dot on the "i" replaced with a small filled
rectangle suggesting a typing cursor; the bottom of the "l" extended
slightly into a thin horizontal stroke that traces under the rest of
the word, evoking a thread underline. Tight tracking, optical
spacing. Solid violet (#7c3aed in light contexts, #a78bfa in dark).
Provide both: black-on-transparent and white-on-transparent SVGs.
```

### Constraints to keep in any prompt you tweak

- Two-stop gradient max (more = harder to print, less timeless).
- Lowercase wordmark; uppercase makes Hilo look enterprisey.
- No literal chat bubble. The whole point is to NOT look like every
  other chat-app logo.
- Safe at 16 px (favicon) AND 256 px (README hero).
- Output as SVG; raster is fallback only.

---

## 3. AI generation — two recommended options

### Option A · **Recraft** (recommended for vector / logo work)

[`recraft.ai`](https://www.recraft.ai)

**Why this first**: Recraft outputs native SVG (not raster traced),
honors specific palettes when you upload swatches, and has a free tier
that's enough for a handful of iterations. Perfect for a clean
geometric mark you'll iterate on.

Workflow:

1. Go to **recraft.ai → Recraft V3 → Vector illustration → Logo**.
2. Paste *Prompt v1* or *v3* from above.
3. In **Style**, pick `Hand drawn` → off, `Iconic` → on.
4. Set **Colors** to a custom palette: paste hex values `#a78bfa`,
   `#67e8f9`, `#0b0f1a`.
5. Generate 8 variations. Export the best as SVG (Recraft → "Download
   SVG").
6. Drop into `static/logo.svg` and reference it from `app.html` + email
   templates.

Pricing: ~50 free credits/month at the time of writing; each logo
generation is 1 credit. Paid tier $12/mo.

### Option B · **Midjourney** (recommended for richer brand artwork)

[`midjourney.com`](https://www.midjourney.com)

**Why this second**: Midjourney v6.1 has the best feel for "brandy"
mood boards and shareable OG cards. SVG output requires a vector trace
afterwards (e.g. via `vectorizer.ai` or Illustrator's Image Trace), but
the source rasters are best-in-class.

Workflow:

1. Discord → Midjourney bot → `/imagine` with one of the prompts above.
2. Append the technical suffix: `--style raw --ar 1:1 --v 6.1 --no
   shadow --no glow`.
3. Upscale the best of the 4 grid → "Vary (Subtle)" for two more
   passes.
4. Download the 2048×2048 raster.
5. Vectorise via [vectorizer.ai](https://vectorizer.ai) (free for one
   download/day) or Adobe Express → Image to vector.
6. Hand-clean the resulting SVG in Figma / Inkscape — remove stray
   anchor points, snap to integer coordinates, then export.

Pricing: Midjourney Basic plan $10/mo. Vectorization free for low
volume.

### Option C (tertiary) · **Ideogram**

[`ideogram.ai`](https://ideogram.ai) — excellent at including legible
**text in the image**, which makes it strong for OG share cards (where
you want "Hilo · feedback simply" as part of the artwork). Raster
output, vectorise as needed.

---

## 4. Outputs needed

Once a logo is finalised, drop these files into `static/` and the
README will pick them up automatically:

| Filename | Size | Format | Purpose |
|---|---|---|---|
| `static/logo.svg` | scalable | SVG | Master mark + wordmark |
| `static/logo-mark.svg` | scalable | SVG | Mark only (no wordmark) |
| `static/favicon.svg` | 32 px | SVG | Browser tab + PWA |
| `static/og-card.png` | 1200 × 630 | PNG | OpenGraph / Twitter cards |
| `static/hero-dark.png` | 1600 × 900 | PNG | README hero (dark) |
| `static/hero-light.png` | 1600 × 900 | PNG | README hero (light) |

Reference them from `src/app.html`:

```html
<link rel="icon" href="%sveltekit.assets%/favicon.svg" />
<meta property="og:image" content="%sveltekit.assets%/og-card.png" />
<meta name="twitter:image" content="%sveltekit.assets%/og-card.png" />
```

---

## 5. Voice & tone

- **Quiet confidence**, not enthusiastic startup yelling.
- Lowercase wherever it's not grammatically wrong — even product names.
- Plain-English nouns over jargon ("ticket", "thread", "reply",
  "follower").
- Spanish second when bilingual ("hilo" = thread); never mix mid-sentence.

Bad: "Supercharge your customer engagement with AI-powered inbox triage."
Good: "Tickets and chat with magic-link emails. Two npm deps."

---

## 6. Logo iteration checklist

Before merging a new logo, verify:

- [ ] Renders crisply at 16 px (favicon) without dropping detail.
- [ ] Works on both `--color-bg-deep` (`#0b0f1a`) and `#f5f7fb`.
- [ ] Looks fine in pure black + pure white (single-colour fallbacks).
- [ ] Wordmark is legible at 24 px height.
- [ ] Total weight ≤ 8 KB as SVG (no embedded bitmaps).
- [ ] Final SVG has named layers (`mark`, `wordmark`, `exclusion-zone`).
