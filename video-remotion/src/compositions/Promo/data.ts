// Scene metadata for the Promo composition. Durations are in frames at 30 fps
// and are derived from the HeyGen narration track's chapter timestamps
// (public/heygen/narration.srt). If the narration is re-recorded, update the
// start times below to match the new SRT.

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

// Chapter start times (seconds) in public/heygen/narration.mp4.
const T = {
  intro: 0,
  f01: 15.52,
  f02: 31.45,
  f03: 47.18,
  f04: 60.88,
  f05: 74.69,
  f06: 86.43,
  f07: 102.06,
  f08: 114.95,
  f09: 128.3,
  f10: 140.89,
  outro: 151.65,
  end: 166.6
};

const frames = (from: number, to: number) => Math.round((to - from) * FPS);

export const INTRO_FRAMES = frames(T.intro, T.f01);
export const OUTRO_FRAMES = frames(T.outro, T.end);

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
    durationInFrames: frames(T.f01, T.f02),
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
    durationInFrames: frames(T.f02, T.f03),
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
    durationInFrames: frames(T.f03, T.f04),
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
    durationInFrames: frames(T.f04, T.f05),
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
    durationInFrames: frames(T.f05, T.f06),
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
    durationInFrames: frames(T.f06, T.f07),
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
    durationInFrames: frames(T.f07, T.f08),
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
    durationInFrames: frames(T.f08, T.f09),
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
    durationInFrames: frames(T.f09, T.f10),
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
    durationInFrames: frames(T.f10, T.outro),
  },
];

export const TOTAL_FRAMES =
  INTRO_FRAMES +
  FEATURES.reduce((sum, f) => sum + f.durationInFrames, 0) +
  OUTRO_FRAMES;
