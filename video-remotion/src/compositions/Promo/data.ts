// Scene metadata for the Promo composition. Durations are in frames at 30 fps
// and MUST stay in sync with video-remotion/NARRATION.md — each narration
// paragraph is written to fit its scene's duration.

export const FPS = 30;

export type Visual =
  | 'chat'
  | 'wave'
  | 'upload'
  | 'checks'
  | 'tasks'
  | 'mail'
  | 'bell'
  | 'admin'
  | 'devices'
  | 'search';

export type FeatureData = {
  index: number; // 1-based feature number shown as 01..10
  title: string;
  bullets: string[];
  visual: Visual;
  durationInFrames: number;
};

export const INTRO_FRAMES = 15 * FPS; // 450
export const OUTRO_FRAMES = 15 * FPS; // 450

export const FEATURES: FeatureData[] = [
  {
    index: 1,
    title: 'Threaded tickets, realtime chat',
    bullets: [
      'One thread per topic — no lost context',
      'Live updates over Server-Sent Events',
      'Typing indicators, reactions, message editing',
    ],
    visual: 'chat',
    durationInFrames: 14 * FPS,
  },
  {
    index: 2,
    title: 'Voice, transcribed on your hardware',
    bullets: [
      'Record voice notes up to two minutes',
      'One-tap transcription — self-hosted Whisper',
      'Dictation streams speech straight into the composer',
    ],
    visual: 'wave',
    durationInFrames: 14 * FPS,
  },
  {
    index: 3,
    title: 'Files that actually arrive',
    bullets: [
      'Resumable chunked uploads up to 500 MB',
      'Survives reloads and flaky connections',
      'Inline images and seekable video previews',
    ],
    visual: 'upload',
    durationInFrames: 13 * FPS,
  },
  {
    index: 4,
    title: 'Know what was seen',
    bullets: [
      'Read receipts with reader name and time',
      'Unread stripes and navbar badge',
      'Inbox eye: has the user seen your reply?',
    ],
    visual: 'checks',
    durationInFrames: 12 * FPS,
  },
  {
    index: 5,
    title: 'Tasks inside the conversation',
    bullets: [
      'Create and assign tasks to any participant',
      'Pending-task chips right in the inbox',
      'Tick done — everyone sees it instantly',
    ],
    visual: 'tasks',
    durationInFrames: 12 * FPS,
  },
  {
    index: 6,
    title: 'Email that works both ways',
    bullets: [
      'Magic-link sign-in from every notification',
      'Rich themed emails with inline previews',
      'Inbound email becomes a ticket (IMAP)',
    ],
    visual: 'mail',
    durationInFrames: 14 * FPS,
  },
  {
    index: 7,
    title: 'Notifications on your terms',
    bullets: [
      'Web Push on desktop and mobile',
      'Per-user quiet hours',
      'Daily digest throttling — never spammed',
    ],
    visual: 'bell',
    durationInFrames: 12 * FPS,
  },
  {
    index: 8,
    title: 'Built for operators',
    bullets: [
      'Projects, groups and per-user access',
      'Audit log, templates, outbound webhooks',
      'Health endpoint and Prometheus metrics',
    ],
    visual: 'admin',
    durationInFrames: 13 * FPS,
  },
  {
    index: 9,
    title: 'Installs like a native app',
    bullets: [
      'PWA on iOS, Android, Windows and macOS',
      'Guided install with short explainer videos',
      'Dark & light themes, four accent colors',
    ],
    visual: 'devices',
    durationInFrames: 12 * FPS,
  },
  {
    index: 10,
    title: 'Find it, export it, wire it up',
    bullets: [
      'Full-text search across every message',
      'CSV export per ticket or workspace-wide',
      'Slack / Discord / generic webhooks',
    ],
    visual: 'search',
    durationInFrames: 10 * FPS,
  },
];

export const TOTAL_FRAMES =
  INTRO_FRAMES +
  FEATURES.reduce((sum, f) => sum + f.durationInFrames, 0) +
  OUTRO_FRAMES;
