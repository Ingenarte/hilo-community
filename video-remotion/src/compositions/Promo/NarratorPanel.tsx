import React from 'react';
import {
  getStaticFiles,
  interpolate,
  OffthreadVideo,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ACCENT, CYAN, FONT, VIOLET } from '../../theme';

/** Geometry shared with the scenes so content never sits under the avatar. */
export const PANEL_WIDTH = 460;
export const PANEL_RIGHT = 70;
/** Right padding for scene content so it never sits under the avatar. */
export const CONTENT_RIGHT_PAD = PANEL_WIDTH + PANEL_RIGHT + 60;

const CLIP = 'heygen/narration.mp4';

/**
 * Persistent narrator panel: the single continuous HeyGen avatar clip
 * (portrait 1080x1920) plays across the whole promo, mounted OUTSIDE the
 * <Series> so it never restarts between scenes. When the clip is absent the
 * panel degrades to a styled placeholder of identical geometry.
 */
export const NarratorPanel: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const exists = getStaticFiles().some((f) => f.name === CLIP);

  const pop = spring({ frame, fps, config: { damping: 200, mass: 0.8 } });
  const height = 818; // 9:16 card
  const shell: React.CSSProperties = {
    position: 'absolute',
    right: PANEL_RIGHT,
    top: (1080 - height) / 2,
    width: PANEL_WIDTH,
    height,
    borderRadius: 30,
    overflow: 'hidden',
    border: '2px solid rgba(255,255,255,0.14)',
    boxShadow: `0 30px 90px ${VIOLET}40`,
    background: '#0c111c',
    transform: `scale(${interpolate(pop, [0, 1], [0.95, 1])})`,
  };

  if (exists) {
    return (
      <div style={shell}>
        <OffthreadVideo
          src={staticFile(CLIP)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  const bars = Array.from({ length: 5 });
  return (
    <div
      style={{
        ...shell,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 26,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          width: 130,
          height: 130,
          borderRadius: 999,
          background: ACCENT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 0 ${40 + Math.sin(frame / 9) * 14}px ${CYAN}66`,
        }}
      >
        <svg width={70} height={70} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-6.5 8-6.5S20 17 20 21" />
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 44 }}>
        {bars.map((_, i) => {
          const h = 12 + Math.abs(Math.sin(frame / 6 + i * 1.1)) * 32;
          return <div key={i} style={{ width: 9, height: h, borderRadius: 999, background: ACCENT }} />;
        })}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>Narrator</div>
      <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>
        drop {CLIP} into public/
      </div>
    </div>
  );
};
