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
import { HeygenSlot } from './HeygenSlot';

/**
 * Hilo promo — intro (HeyGen narrator slot), ten numbered feature chapters,
 * open-source outro. ~2:36 at 30 fps, 1920x1080. Narration script lives in
 * video-remotion/NARRATION.md; scene durations are defined in ./data.ts and
 * must stay in sync with it.
 */

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200, mass: 0.8 } });
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#fff' }}>
      <Background />
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', padding: 100, gap: 90 }}>
        <HeygenSlot clip="intro" width={780} height={620} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 34,
            opacity: interpolate(s, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <HiloGlyph size={110} id="promo-intro" />
            <GradientText size={110}>Hilo</GradientText>
          </div>
          <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.25, color: 'rgba(255,255,255,0.9)' }}>
            Self-hosted tickets + chat
            <br />
            for small teams.
          </div>
          <div style={{ fontFamily: MONO, fontSize: 28, color: 'rgba(255,255,255,0.55)' }}>
            {URL}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200, mass: 0.8 } });
  const s2 = spring({ frame: Math.max(0, frame - 30), fps, config: { damping: 200, mass: 0.7 } });
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#fff' }}>
      <Background />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 40, padding: 100 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 26,
            opacity: interpolate(s, [0, 1], [0, 1]),
            transform: `scale(${interpolate(s, [0, 1], [0.9, 1])})`,
          }}
        >
          <HiloGlyph size={96} id="promo-outro" />
          <GradientText size={92}>Free & open source</GradientText>
        </div>
        <div
          style={{
            fontSize: 40,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.85)',
            textAlign: 'center',
            lineHeight: 1.35,
            opacity: interpolate(s2, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(s2, [0, 1], [26, 0])}px)`,
          }}
        >
          MIT-licensed. Clone it, run <span style={{ fontFamily: MONO }}>docker compose up</span>,
          <br />
          and own your support stack.
        </div>
        <div
          style={{
            padding: '24px 54px',
            borderRadius: 999,
            background: ACCENT,
            fontFamily: MONO,
            fontSize: 38,
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
);
