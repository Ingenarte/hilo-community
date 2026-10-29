import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ACCENT, CYAN, FONT, MONO } from '../../theme';
import type { FeatureData } from './data';
import { CONTENT_RIGHT_PAD } from './NarratorPanel';
import { FeatureVisual } from './Visuals';

/**
 * One numbered feature chapter: oversized gradient index numeral on the left
 * with title + staggered bullets, animated feature sketch in a card on the
 * right. Engineering-slide aesthetic, consistent across all ten features.
 */
export const FeatureScene: React.FC<{ data: FeatureData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200, mass: 0.7 } });
  const slide = interpolate(enter, [0, 1], [60, 0]);
  const fadeOut = interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], {
    extrapolateLeft: 'clamp',
  });

  const numeral = String(data.index).padStart(2, '0');

  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#fff', opacity: fadeOut }}>
      <AbsoluteFill
        style={{
          flexDirection: 'row',
          padding: 80,
          paddingRight: CONTENT_RIGHT_PAD,
          gap: 50,
          alignItems: 'center',
        }}
      >
        {/* Left: numeral + title + bullets */}
        <div style={{ flex: 1.15, transform: `translateX(${-slide}px)` }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 150,
              fontWeight: 800,
              lineHeight: 1,
              backgroundImage: ACCENT,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              marginBottom: 8,
            }}
          >
            {numeral}
          </div>
          <div style={{ fontSize: 50, fontWeight: 900, letterSpacing: -1.2, lineHeight: 1.08, marginBottom: 36 }}>
            {data.title}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {data.bullets.map((b, i) => {
              const d = 18 + i * 14;
              const s = spring({ frame: Math.max(0, frame - d), fps, config: { damping: 200, mass: 0.6 } });
              return (
                <div
                  key={b}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20,
                    opacity: interpolate(s, [0, 1], [0, 1]),
                    transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px)`,
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      background: ACCENT,
                      transform: 'rotate(45deg)',
                      flexShrink: 0,
                      boxShadow: `0 0 16px ${CYAN}88`,
                    }}
                  />
                  <span style={{ fontSize: 28, color: 'rgba(255,255,255,0.82)', fontWeight: 500 }}>{b}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: animated feature sketch */}
        <div
          style={{
            flex: 1,
            height: 580,
            borderRadius: 30,
            background: 'rgba(255,255,255,0.035)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 40px 120px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 50,
            transform: `translateX(${slide}px)`,
          }}
        >
          <FeatureVisual visual={data.visual} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
