# video-remotion

Standalone [Remotion](https://remotion.dev) v4 project that renders the four
PWA install help videos shown in Hilo's `?` (help) panel. It is intentionally
**separate** from the SvelteKit app — its React/Remotion dependencies must never
be hoisted into the app's `package.json`.

## What it produces

| Composition      | Output (committed)        | Size       |
| ---------------- | ------------------------- | ---------- |
| `IosInstall`     | `../static/help/ios.mp4`  | 1080×1920  |
| `AndroidInstall` | `../static/help/android.mp4` | 1080×1920 |
| `WindowsInstall` | `../static/help/windows.mp4` | 1920×1080 |
| `MacosInstall`   | `../static/help/macos.mp4`   | 1920×1080 |

A matching `<key>.jpg` poster (frame 140) is rendered next to each clip and used
as the `<video poster>` in the help panel.

The clips are stylized branded explainers (animated device mockups), **not** real
screen recordings.

## Render

```bash
cd video-remotion
npm install            # or pnpm install
npm run render         # renders all 4 mp4s + posters into ../static/help
```

The first render downloads a Remotion-managed Chromium (~150–250 MB); it looks
like it hangs while downloading. Individual targets: `npm run render:ios`, etc.

## Edit / preview

```bash
npm run studio        # opens Remotion Studio at http://localhost:3000
```

Captions live in `src/compositions/*.tsx`; shared visuals in
`src/components.tsx`; brand constants in `src/theme.ts`.
