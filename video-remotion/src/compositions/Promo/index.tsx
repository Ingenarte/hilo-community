import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  Series,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Background, GradientText, HiloGlyph } from '../../components';
import { ACCENT, CYAN, FONT, MONO, REPO_URL, URL, VIOLET } from '../../theme';
import { FEATURES, INTRO_FRAMES, OUTRO_FRAMES } from './data';
import { FeatureScene } from './FeatureScene';
import { CONTENT_RIGHT_PAD, NarratorPanel } from './NarratorPanel';

/**
 * Hilo promo — one continuous HeyGen narration clip in a persistent right
 * panel, with the intro, ten numbered feature chapters and the open-source
 * outro sequenced on the left. Scene durations in ./data.ts are derived from
 * the narration's SRT chapter timestamps, so picture and voice stay in sync.
 * 1920x1080 @ 30 fps, ~2:46 total.
 */

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200, mass: 0.8 } });
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#fff' }}>
      <AbsoluteFill
        style={{
          padding: 100,
          paddingRight: CONTENT_RIGHT_PAD,
          justifyContent: 'center',
          gap: 34,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 34,
            opacity: interpolate(s, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <HiloGlyph size={120} id="promo-intro" />
            <GradientText size={120}>Hilo</GradientText>
          </div>
          <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.22, color: 'rgba(255,255,255,0.92)' }}>
            Self-hosted tickets + chat
            <br />
            for small teams.
          </div>
          <div style={{ fontSize: 32, fontWeight: 500, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
            Ten things it does really well —
            <br />
            in two and a half minutes.
          </div>
          <div style={{ fontFamily: MONO, fontSize: 28, color: CYAN }}>{URL}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200, mass: 0.8 } });
  const s2 = spring({ frame: Math.max(0, frame - 25), fps, config: { damping: 200, mass: 0.7 } });
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#fff' }}>
      <AbsoluteFill
        style={{
          padding: 100,
          paddingRight: CONTENT_RIGHT_PAD,
          justifyContent: 'center',
          gap: 36,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            opacity: interpolate(s, [0, 1], [0, 1]),
            transform: `scale(${interpolate(s, [0, 1], [0.92, 1])})`,
          }}
        >
          <HiloGlyph size={88} id="promo-outro" />
          <GradientText size={80}>Free & open source</GradientText>
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.4,
            opacity: interpolate(s2, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(s2, [0, 1], [26, 0])}px)`,
          }}
        >
          MIT-licensed. Clone it, run{' '}
          <span style={{ fontFamily: MONO, color: CYAN }}>docker compose up</span>,
          <br />
          and own your support stack.
        </div>
        <div
          style={{
            alignSelf: 'flex-start',
            padding: '22px 46px',
            borderRadius: 999,
            background: ACCENT,
            fontFamily: MONO,
            fontSize: 32,
            fontWeight: 800,
            boxShadow: `0 0 ${50 + Math.sin(frame / 8) * 18}px ${VIOLET}88`,
            opacity: interpolate(s2, [0, 1], [0, 1]),
          }}
        >
          {REPO_URL}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 26, color: CYAN, opacity: interpolate(s2, [0, 1], [0, 0.9]) }}>
          {URL}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ fontFamily: FONT }}>
    {/* Shared animated backdrop — continuous across scene cuts. */}
    <Background />
    <Series>
      <Series.Sequence durationInFrames={INTRO_FRAMES}>
        <Intro />
      </Series.Sequence>
      {FEATURES.map((f) => (
        <Series.Sequence key={f.index} durationInFrames={f.durationInFrames}>
          <FeatureScene data={f} />
        </Series.Sequence>
      ))}
      <Series.Sequence durationInFrames={OUTRO_FRAMES}>
        <Outro />
      </Series.Sequence>
    </Series>
    {/* Mounted outside the Series so the narration never restarts. */}
    <NarratorPanel />
  </AbsoluteFill>
);
