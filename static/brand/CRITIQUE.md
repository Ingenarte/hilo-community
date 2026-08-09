# Brand candidates · Claude critique

## Ranking

1. **logo-v1.png** — Clean single-stroke "h" with loop reads clearly at small sizes; gradient follows spec exactly; unique without being gimmicky.

2. **logo-v2.png** — Same concept but the 3D ribbon/overlap adds shading complexity that will muddy at 16px; loses the "quiet" aesthetic.

3. **logo-v3.png** — Generic hamburger-menu / list icon; not brandable, not memorable, says nothing about "Hilo"; will vanish in a sea of similar app icons.

---

## Recommendation: **logo-v1**

**Why it wins:**
- Single continuous stroke survives aggressive downscaling
- Two-stop gradient (violet → cyan) on-brand
- Lowercase letterform matches brand voice
- No chat-bubble, no cliché

**Next steps:**

1. **Vectorise** — Redraw in Figma or Illustrator as a single compound path; keep stroke width ≥ 1.5 px at 16 px export to avoid anti-alias blur.
2. **Test both backgrounds** — Export favicon over `#0b0f1a` and `#f5f7fb`; if cyan tail disappears on light, add a subtle 4 % darker outline or thicken the stroke.
3. **Size kit** — Produce SVG master, then PNG at 16, 32, 180 (Apple touch), and 512 (og-image / store).
4. **Simplify for mono** — Create a single-color (white or violet) variant for contexts where gradient isn't viable (ASCII docs, embroidery, etc.).

Ship v1; revisit only if 16 px field testing reveals legibility issues.
