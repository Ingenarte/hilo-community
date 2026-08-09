// Shared visual constants for the four install explainer videos. Mirrors the
// Hilo brand: dark #0b0f1a canvas with a cyan -> violet accent gradient.
export const BG = '#0b0f1a';
export const CYAN = '#22d3ee';
export const VIOLET = '#7c3aed';
export const ACCENT = `linear-gradient(135deg, ${CYAN}, ${VIOLET})`;

export const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Inter, sans-serif';
export const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

// Instance host shown in the browser-chrome mockups. Override per deployment
// via video-remotion/.env (REMOTION_HILO_URL=your.host) — Remotion only
// exposes env vars prefixed with REMOTION_.
export const URL = process.env.REMOTION_HILO_URL ?? 'hilo.example.com';

// Public community repository advertised in the promo outro.
export const REPO_URL =
  process.env.REMOTION_REPO_URL ?? 'github.com/Ingenarte/hilo-community';

export type Step = { title: string; sub: string };

// Which affordance the device chrome highlights, per platform.
export type Affordance = 'share' | 'dots' | 'install';
