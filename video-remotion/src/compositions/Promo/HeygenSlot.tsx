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

/**
 * Placeholder-aware slot for the HeyGen avatar clips.
 *
 * Drop the rendered clips into `video-remotion/public/heygen/{intro,outro}.mp4`
 * and this component plays them; while they are absent it renders a styled
 * "Narrator" card of identical size and duration, so the full promo renders
 * end-to-end today and the timing never shifts when the real clips land.
 */
export const HeygenSlot: React.FC<{
  clip: 'intro' | 'outro';
  width: number;
  height: number;
}> = ({ clip, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const name = `heygen/${clip}.mp4`;
  const exists = getStaticFiles().some((f) => f.name === name);

  const pop = spring({ frame, fps, config: { damping: 200, mass: 0.7 } });
  const scale = interpolate(pop, [0, 1], [0.94, 1]);

  const shell: React.CSSProperties = {
    width,
    height,
    borderRadius: 28,
    overflow: 'hidden',
    border: `2px solid rgba(255,255,255,0.14)`,
    boxShadow: `0 30px 90px ${VIOLET}40`,
    transform: `scale(${scale})`,
    background: '#0c111c',
    position: 'relative',
  };

  if (exists) {
    return (
      <div style={shell}>
        <OffthreadVideo
          src={staticFile(name)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  // Narrator placeholder: pulsing avatar silhouette + equalizer bars.
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
          return (
            <div
              key={i}
              style={{ width: 9, height: h, borderRadius: 999, background: ACCENT }}
            />
          );
        })}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
        Narrator
      </div>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>
        drop heygen/{clip}.mp4 into public/
      </div>
    </div>
  );
};
