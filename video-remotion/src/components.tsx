import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ACCENT, BG, CYAN, FONT, MONO, URL, VIOLET } from './theme';
import type { Affordance, Step } from './theme';

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const x1 = 30 + Math.sin(t * 0.6) * 8;
  const y1 = 10 + Math.cos(t * 0.5) * 6;
  const x2 = 75 + Math.cos(t * 0.4) * 8;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(60% 50% at ${x1}% ${y1}%, ${VIOLET}38, transparent 70%),
                     radial-gradient(55% 45% at ${x2}% 85%, ${CYAN}26, transparent 70%),
                     ${BG}`,
      }}
    />
  );
};

/* ------------------------------------------------------------------ */
/* Gradient title                                                     */
/* ------------------------------------------------------------------ */

export const GradientText: React.FC<{
  children: React.ReactNode;
  size: number;
}> = ({ children, size }) => (
  <div
    style={{
      fontSize: size,
      fontWeight: 900,
      letterSpacing: -1,
      lineHeight: 1.05,
      backgroundImage: `linear-gradient(90deg, ${CYAN}, ${VIOLET})`,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      textAlign: 'center',
    }}
  >
    {children}
  </div>
);

/* ------------------------------------------------------------------ */
/* Hilo glyph (rounded gradient tile + thread mark)                   */
/* ------------------------------------------------------------------ */

export const HiloGlyph: React.FC<{ size: number; id?: string }> = ({
  size,
  id = 'g',
}) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
    <defs>
      <linearGradient id={`hilo-${id}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={CYAN} />
        <stop offset="100%" stopColor={VIOLET} />
      </linearGradient>
    </defs>
    <rect x="6" y="6" width="88" height="88" rx="26" fill={`url(#hilo-${id})`} />
    <path
      d="M36 30 v40 M36 50 h28 M64 30 v40"
      stroke="#fff"
      strokeWidth="7"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

/* ------------------------------------------------------------------ */
/* Affordance icon (share / 3-dots / install) + tap pulse             */
/* ------------------------------------------------------------------ */

const AffordanceGlyph: React.FC<{ type: Affordance }> = ({ type }) => {
  const common = {
    width: 30,
    height: 30,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: '#e8edf6',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (type === 'share') {
    return (
      <svg {...common}>
        <path d="M12 3v12" />
        <path d="M8 7l4-4 4 4" />
        <path d="M6 12H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1" />
      </svg>
    );
  }
  if (type === 'dots') {
    return (
      <svg {...common}>
        <circle cx="12" cy="5" r="1.4" fill="#e8edf6" />
        <circle cx="12" cy="12" r="1.4" fill="#e8edf6" />
        <circle cx="12" cy="19" r="1.4" fill="#e8edf6" />
      </svg>
    );
  }
  // install: monitor with down arrow
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 8v5" />
      <path d="M9.5 11l2.5 2.5 2.5-2.5" />
      <path d="M9 20h6" />
    </svg>
  );
};

const TapPulse: React.FC<{ active: boolean }> = ({ active }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!active) return null;
  const loop = (frame % Math.round(fps * 1.1)) / (fps * 1.1);
  const scale = interpolate(loop, [0, 1], [0.6, 2.2]);
  const opacity = interpolate(loop, [0, 1], [0.55, 0]);
  return (
    <div
      style={{
        position: 'absolute',
        inset: -6,
        borderRadius: 14,
        border: `3px solid ${CYAN}`,
        transform: `scale(${scale})`,
        opacity,
      }}
    />
  );
};

const AffordanceButton: React.FC<{ type: Affordance; active: boolean }> = ({
  type,
  active,
}) => (
  <div
    style={{
      position: 'relative',
      width: 50,
      height: 40,
      borderRadius: 12,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? `${VIOLET}40` : 'rgba(255,255,255,0.06)',
      border: `1px solid ${active ? CYAN : 'rgba(255,255,255,0.12)'}`,
      boxShadow: active ? `0 0 22px ${CYAN}80` : 'none',
    }}
  >
    <AffordanceGlyph type={type} />
    <TapPulse active={active} />
  </div>
);

/* ------------------------------------------------------------------ */
/* Browser chrome shown inside the device                             */
/* ------------------------------------------------------------------ */

const BrowserChrome: React.FC<{
  affordance: Affordance;
  highlight: boolean;
  compact?: boolean;
}> = ({ affordance, highlight, compact }) => {
  const frame = useCurrentFrame();
  const typed = Math.min(URL.length, Math.max(0, Math.round((frame - 6) / 1.4)));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: compact ? '14px 16px' : '18px 22px',
        background: 'rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        {[VIOLET, CYAN, '#ffffff40'].map((c) => (
          <span
            key={c}
            style={{ width: 12, height: 12, borderRadius: 999, background: c }}
          />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          height: compact ? 38 : 44,
          borderRadius: 999,
          background: 'rgba(0,0,0,0.35)',
          border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px',
          fontFamily: MONO,
          fontSize: compact ? 20 : 22,
          color: 'rgba(255,255,255,0.82)',
        }}
      >
        {URL.slice(0, typed)}
        <span style={{ opacity: typed < URL.length ? 1 : 0 }}>|</span>
      </div>
      <AffordanceButton type={affordance} active={highlight} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* App mock shown below the chrome                                    */
/* ------------------------------------------------------------------ */

const AppMock: React.FC<{ rows: number }> = ({ rows }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        padding: 28,
      }}
    >
      <HiloGlyph size={108} id="app" />
      <div style={{ fontSize: 40, fontWeight: 800, color: '#fff' }}>Hilo</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '86%' }}>
        {Array.from({ length: rows }).map((_, i) => {
          const shimmer = 0.18 + 0.12 * Math.sin(frame / 8 + i);
          return (
            <div
              key={i}
              style={{
                height: 30,
                borderRadius: 10,
                background: `rgba(255,255,255,${shimmer})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Device shells                                                      */
/* ------------------------------------------------------------------ */

const useFloat = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 120, mass: 0.8 } });
  const float = Math.sin((frame / fps) * 1.5) * 8;
  return { scale: interpolate(pop, [0, 1], [0.86, 1]), float };
};

export const PhoneShell: React.FC<{
  affordance: Affordance;
  highlight: boolean;
}> = ({ affordance, highlight }) => {
  const { scale, float } = useFloat();
  return (
    <div
      style={{
        transform: `translateY(${float}px) scale(${scale})`,
        width: 360,
        height: 740,
        borderRadius: 56,
        padding: 14,
        background: 'linear-gradient(160deg, #1b2233, #0c111c)',
        border: '2px solid rgba(255,255,255,0.12)',
        boxShadow: `0 40px 120px ${CYAN}33`,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 44,
          overflow: 'hidden',
          background: BG,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <BrowserChrome affordance={affordance} highlight={highlight} compact />
        <AppMock rows={3} />
      </div>
    </div>
  );
};

export const LaptopShell: React.FC<{
  affordance: Affordance;
  highlight: boolean;
}> = ({ affordance, highlight }) => {
  const { scale, float } = useFloat();
  return (
    <div
      style={{
        transform: `translateY(${float}px) scale(${scale})`,
        width: 760,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          height: 440,
          borderRadius: 22,
          overflow: 'hidden',
          background: BG,
          border: '2px solid rgba(255,255,255,0.12)',
          boxShadow: `0 40px 110px ${VIOLET}3a`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <BrowserChrome affordance={affordance} highlight={highlight} />
        <AppMock rows={4} />
      </div>
      {/* laptop base */}
      <div
        style={{
          width: 850,
          height: 22,
          borderRadius: '0 0 16px 16px',
          background: 'linear-gradient(180deg, #2a3346, #151b28)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Step caption                                                       */
/* ------------------------------------------------------------------ */

export const StepCaption: React.FC<{
  index: number;
  step: Step;
  startFrame: number;
  active: boolean;
}> = ({ index, step, startFrame, active }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = Math.max(0, frame - startFrame);
  const enter = spring({ frame: local, fps, config: { damping: 200, mass: 0.6 } });
  const translateY = interpolate(enter, [0, 1], [26, 0]);
  const opacity = interpolate(enter, [0, 1], [0, active ? 1 : 0.55]);

  return (
    <div
      style={{
        transform: `translateY(${translateY}px)`,
        opacity,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '20px 24px',
        borderRadius: 20,
        background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? CYAN : 'rgba(255,255,255,0.1)'}`,
        boxShadow: active ? `0 18px 50px rgba(0,0,0,0.45)` : 'none',
      }}
    >
      <div
        style={{
          minWidth: 56,
          height: 56,
          borderRadius: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          fontWeight: 800,
          color: '#fff',
          background: active ? ACCENT : 'rgba(255,255,255,0.1)',
        }}
      >
        {index + 1}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: '#fff' }}>
          {step.title}
        </div>
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.66)' }}>
          {step.sub}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Progress bar                                                       */
/* ------------------------------------------------------------------ */

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = interpolate(frame, [0, durationInFrames - 1], [0, 100], {
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 60,
        right: 60,
        bottom: 40,
        height: 8,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.1)',
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: ACCENT }} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* InstallScene — the orchestrator used by every composition          */
/* ------------------------------------------------------------------ */

export const InstallScene: React.FC<{
  title: string;
  device: 'phone' | 'laptop';
  affordance: Affordance;
  steps: Step[];
  /** Step indices (0-based) during which the device affordance glows. */
  highlightSteps: number[];
}> = ({ title, device, affordance, steps, highlightSteps }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const intro = 24;
  const per = (durationInFrames - intro) / steps.length;
  const activeIndex = Math.min(
    steps.length - 1,
    Math.max(0, Math.floor((frame - intro) / per))
  );
  const highlight = highlightSteps.includes(activeIndex);
  const startFor = (i: number) => Math.round(intro + i * per);

  const stepsColumn = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        width: '100%',
        maxWidth: device === 'phone' ? 860 : 560,
      }}
    >
      {steps.map((step, i) => (
        <StepCaption
          key={step.title}
          index={i}
          step={step}
          startFrame={startFor(i)}
          active={i === activeIndex}
        />
      ))}
    </div>
  );

  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#fff' }}>
      <Background />
      {device === 'phone' ? (
        <AbsoluteFill
          style={{
            padding: 70,
            paddingBottom: 96,
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 40,
          }}
        >
          <GradientText size={62}>{title}</GradientText>
          <PhoneShell affordance={affordance} highlight={highlight} />
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
            {stepsColumn}
          </div>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{ padding: 70, paddingBottom: 90, gap: 30 }}
        >
          <GradientText size={58}>{title}</GradientText>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 56,
            }}
          >
            <LaptopShell affordance={affordance} highlight={highlight} />
            {stepsColumn}
          </div>
        </AbsoluteFill>
      )}
      <ProgressBar />
    </AbsoluteFill>
  );
};
