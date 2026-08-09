#!/usr/bin/env bash
# Convert the Playwright-recorded `demo` test video to an optimised GIF.
#
# Requires ffmpeg. Install on macOS:  brew install ffmpeg
# On Debian/Ubuntu:                    sudo apt install ffmpeg
#
# Usage:
#   pnpm demo                  # record the .webm
#   scripts/demo-to-gif.sh     # convert to docs/demo.gif

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$(find "$ROOT/playwright/output" -name '*.webm' -type f -print -quit)"
OUT_GIF="$ROOT/docs/demo.gif"
OUT_WEBM="$ROOT/docs/demo.webm"

if [ -z "$SRC" ]; then
  echo "No .webm video found under playwright/output/." >&2
  echo "Run \`pnpm demo\` first." >&2
  exit 1
fi

mkdir -p "$ROOT/docs"
cp "$SRC" "$OUT_WEBM"
echo "[demo] copied source → $OUT_WEBM"

if ! command -v ffmpeg >/dev/null; then
  echo "[demo] ffmpeg not found, skipping GIF conversion." >&2
  exit 0
fi

PALETTE="$(mktemp -d)/palette.png"
FPS=14
WIDTH=960

ffmpeg -y -i "$SRC" \
  -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=full" \
  -loglevel error "$PALETTE"

ffmpeg -y -i "$SRC" -i "$PALETTE" \
  -filter_complex "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=5" \
  -loglevel error "$OUT_GIF"

SIZE=$(stat -f%z "$OUT_GIF" 2>/dev/null || stat -c%s "$OUT_GIF")
HUMAN=$(awk -v b="$SIZE" 'BEGIN{ split("B KB MB GB",u); i=1; while(b>=1024 && i<4){b/=1024; i++} printf "%.1f %s", b, u[i] }')
echo "[demo] wrote $OUT_GIF ($HUMAN)"
