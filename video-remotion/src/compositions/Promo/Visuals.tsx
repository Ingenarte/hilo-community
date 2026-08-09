import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ACCENT, BG, CYAN, MONO, VIOLET } from '../../theme';
import type { Visual } from './data';

/**
 * Per-feature animated visual shown inside a card on the right side of each
 * FeatureScene. Each variant is a compact motion sketch of the feature —
 * deliberately abstract (no real user data), engineering-diagram aesthetic.
 */

const useEnter = (delay: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 200, mass: 0.6 } });
  return {
    opacity: interpolate(s, [0, 1], [0, 1]),
    y: interpolate(s, [0, 1], [22, 0]),
    s,
  };
};

const Bubble: React.FC<{ delay: number; mine?: boolean; w: number }> = ({ delay, mine, w }) => {
  const { opacity, y } = useEnter(delay);
  return (
    <div
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        width: w,
        height: 46,
        borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: mine ? `${VIOLET}66` : 'rgba(255,255,255,0.10)',
        border: `1px solid ${mine ? VIOLET : 'rgba(255,255,255,0.14)'}`,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    />
  );
};

const ChatVisual: React.FC = () => {
  const frame = useCurrentFrame();
  const dots = Array.from({ length: 3 });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
      <Bubble delay={5} w={280} />
      <Bubble delay={22} mine w={330} />
      <Bubble delay={40} w={240} />
      <Bubble delay={58} mine w={290} />
      <div style={{ display: 'flex', gap: 7, paddingLeft: 8, marginTop: 6 }}>
        {dots.map((_, i) => (
          <div
            key={i}
            style={{
              width: 11,
              height: 11,
              borderRadius: 999,
              background: CYAN,
              opacity: 0.35 + 0.65 * Math.abs(Math.sin(frame / 8 + i * 0.9)),
            }}
          />
        ))}
      </div>
    </div>
  );
};

const WaveVisual: React.FC = () => {
  const frame = useCurrentFrame();
  const bars = Array.from({ length: 34 });
  const typed = 'Transcribing on-device…';
  const n = Math.min(typed.length, Math.max(0, Math.round((frame - 40) / 2)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 30, alignItems: 'center', width: '100%' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 120 }}>
        {bars.map((_, i) => {
          const h = 14 + Math.abs(Math.sin(frame / 5 + i * 0.55)) * 92;
          return <div key={i} style={{ width: 8, height: h, borderRadius: 999, background: ACCENT }} />;
        })}
      </div>
      <div
        style={{
          width: '92%',
          padding: '16px 20px',
          borderRadius: 14,
          background: 'rgba(0,0,0,0.35)',
          border: '1px solid rgba(255,255,255,0.12)',
          fontFamily: MONO,
          fontSize: 24,
          color: 'rgba(255,255,255,0.85)',
          minHeight: 60,
        }}
      >
        {typed.slice(0, n)}
        <span style={{ opacity: n < typed.length ? 1 : 0 }}>|</span>
      </div>
    </div>
  );
};

const UploadVisual: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  // Progress pauses mid-way ("connection drop") then resumes — the resumable story.
  const pct = interpolate(
    frame,
    [10, fps * 4, fps * 5.2, durationInFrames - 30],
    [0, 62, 62, 100],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const paused = frame > fps * 4 && frame < fps * 5.2;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '92%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 24, color: 'rgba(255,255,255,0.8)' }}>
        <span>design-review.mp4 · 480 MB</span>
        <span style={{ color: paused ? '#fbbf24' : CYAN }}>
          {paused ? 'reconnecting…' : `${Math.round(pct)}%`}
        </span>
      </div>
      <div style={{ height: 20, borderRadius: 999, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: ACCENT, borderRadius: 999 }} />
      </div>
      <div style={{ display: 'flex', gap: 14 }}>
        {['chunk 05', 'chunk 06', 'chunk 07'].map((c, i) => {
          const { opacity, y } = useEnter(20 + i * 16);
          return (
            <div
              key={c}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: `1px solid ${CYAN}55`,
                background: `${CYAN}14`,
                fontFamily: MONO,
                fontSize: 20,
                color: 'rgba(255,255,255,0.75)',
                opacity,
                transform: `translateY(${y}px)`,
              }}
            >
              {c} ✓
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ChecksVisual: React.FC = () => {
  const { s } = useEnter(30);
  const rows = [
    { label: 'Sent', double: false, delay: 6 },
    { label: 'Delivered', double: true, delay: 26 },
    { label: 'Read by Alex · 09:41', double: true, cyan: true, delay: 48 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '88%' }}>
      {rows.map((r) => {
        const e = useEnter(r.delay);
        const color = r.cyan ? CYAN : 'rgba(255,255,255,0.5)';
        return (
          <div
            key={r.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 22px',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${r.cyan ? CYAN : 'rgba(255,255,255,0.12)'}`,
              opacity: e.opacity,
              transform: `translateY(${e.y}px)`,
            }}
          >
            <span style={{ fontSize: 26, color: 'rgba(255,255,255,0.85)' }}>{r.label}</span>
            <svg width={44} height={26} viewBox="0 0 44 26" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round">
              <path d="M4 14l6 6L22 8" />
              {r.double && <path d="M20 14l6 6L38 8" style={{ opacity: r.cyan ? s : 1 }} />}
            </svg>
          </div>
        );
      })}
    </div>
  );
};

const TasksVisual: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const done = spring({ frame: Math.max(0, frame - fps * 3), fps, config: { damping: 160 } });
  const items = [
    { t: 'Reproduce the report', delay: 6, doneAnim: true },
    { t: 'Attach console trace', delay: 24 },
    { t: 'Ship the fix', delay: 42, you: true },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '90%' }}>
      {items.map((it) => {
        const e = useEnter(it.delay);
        const isDone = it.doneAnim ? done : 0;
        return (
          <div
            key={it.t}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '18px 22px',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${it.you ? '#fbbf24' : 'rgba(255,255,255,0.12)'}`,
              opacity: e.opacity,
              transform: `translateY(${e.y}px)`,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: `2px solid ${isDone > 0.5 ? CYAN : 'rgba(255,255,255,0.3)'}`,
                background: isDone > 0.5 ? `${CYAN}33` : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth={3.4} strokeLinecap="round" style={{ opacity: isDone }}>
                <path d="M4 13l5 5L20 6" />
              </svg>
            </div>
            <span
              style={{
                fontSize: 26,
                color: 'rgba(255,255,255,0.85)',
                textDecoration: isDone > 0.5 ? 'line-through' : 'none',
                opacity: isDone > 0.5 ? 0.55 : 1,
                flex: 1,
              }}
            >
              {it.t}
            </span>
            {it.you && (
              <span style={{ fontSize: 17, fontWeight: 800, color: '#fbbf24', border: '1px solid #fbbf24', borderRadius: 8, padding: '3px 10px' }}>
                YOU
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

const MailVisual: React.FC = () => {
  const e1 = useEnter(8);
  const e2 = useEnter(46);
  const arrow = useEnter(30);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', width: '92%' }}>
      <div
        style={{
          width: '100%',
          borderRadius: 16,
          border: `1px solid ${VIOLET}66`,
          background: 'rgba(255,255,255,0.05)',
          padding: '20px 24px',
          opacity: e1.opacity,
          transform: `translateY(${e1.y}px)`,
        }}
      >
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>New reply on your ticket</div>
        <div
          style={{
            display: 'inline-block',
            padding: '12px 26px',
            borderRadius: 999,
            background: ACCENT,
            color: '#fff',
            fontWeight: 800,
            fontSize: 24,
          }}
        >
          Open conversation →
        </div>
      </div>
      <svg width={40} height={44} viewBox="0 0 40 44" style={{ opacity: arrow.opacity }}>
        <path d="M20 2v34M8 26l12 12 12-12" stroke={CYAN} strokeWidth={4} fill="none" strokeLinecap="round" />
      </svg>
      <div
        style={{
          width: '100%',
          borderRadius: 16,
          border: `1px solid ${CYAN}55`,
          background: `${CYAN}10`,
          padding: '18px 24px',
          fontSize: 24,
          color: 'rgba(255,255,255,0.85)',
          opacity: e2.opacity,
          transform: `translateY(${e2.y}px)`,
        }}
      >
        Signed in — no password typed. Reply lands back in the thread.
      </div>
    </div>
  );
};

const BellVisual: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ring = Math.sin(frame / 4) * interpolate(frame % (fps * 3), [0, 20, 40], [0, 14, 0], { extrapolateRight: 'clamp' });
  const e = useEnter(30);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 34, alignItems: 'center' }}>
      <svg width={120} height={120} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.6} style={{ transform: `rotate(${ring}deg)` }}>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke={CYAN} />
        <path d="M10.3 21a2 2 0 0 0 3.4 0" stroke={CYAN} />
      </svg>
      <div
        style={{
          padding: '16px 28px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'rgba(255,255,255,0.06)',
          fontFamily: MONO,
          fontSize: 24,
          color: 'rgba(255,255,255,0.85)',
          opacity: e.opacity,
          transform: `translateY(${e.y}px)`,
        }}
      >
        quiet hours 22:00 → 07:00 <span style={{ color: CYAN }}>✓ respected</span>
      </div>
    </div>
  );
};

const AdminVisual: React.FC = () => {
  const rows = ['ticket.assigned → webhook', 'user.login · audit', 'metrics: p95 41ms'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '92%' }}>
      {rows.map((r, i) => {
        const e = useEnter(10 + i * 20);
        return (
          <div
            key={r}
            style={{
              fontFamily: MONO,
              fontSize: 25,
              color: 'rgba(255,255,255,0.82)',
              padding: '18px 22px',
              borderRadius: 14,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderLeft: `4px solid ${i === 2 ? CYAN : VIOLET}`,
              opacity: e.opacity,
              transform: `translateY(${e.y}px)`,
            }}
          >
            {r}
          </div>
        );
      })}
    </div>
  );
};

const DevicesVisual: React.FC = () => {
  const phone = useEnter(8);
  const laptop = useEnter(28);
  const accents = ['#7c3aed', '#22d3ee', '#10b981', '#f59e0b'];
  const e = useEnter(50);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 30, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 34, alignItems: 'flex-end' }}>
        <div
          style={{
            width: 110,
            height: 210,
            borderRadius: 24,
            border: '2px solid rgba(255,255,255,0.2)',
            background: `linear-gradient(160deg, #1b2233, ${BG})`,
            opacity: phone.opacity,
            transform: `translateY(${phone.y}px)`,
          }}
        />
        <div style={{ opacity: laptop.opacity, transform: `translateY(${laptop.y}px)` }}>
          <div
            style={{
              width: 320,
              height: 190,
              borderRadius: 14,
              border: '2px solid rgba(255,255,255,0.2)',
              background: `linear-gradient(160deg, #1b2233, ${BG})`,
            }}
          />
          <div style={{ width: 370, height: 12, margin: '0 -25px', borderRadius: '0 0 10px 10px', background: '#2a3346' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, opacity: e.opacity, transform: `translateY(${e.y}px)` }}>
        {accents.map((c) => (
          <div key={c} style={{ width: 42, height: 42, borderRadius: 999, background: c, border: '2px solid rgba(255,255,255,0.35)' }} />
        ))}
      </div>
    </div>
  );
};

const SearchVisual: React.FC = () => {
  const frame = useCurrentFrame();
  const q = 'invoice attachment';
  const n = Math.min(q.length, Math.max(0, Math.round((frame - 8) / 2)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '92%' }}>
      <div
        style={{
          padding: '16px 22px',
          borderRadius: 999,
          background: 'rgba(0,0,0,0.35)',
          border: `1px solid ${CYAN}66`,
          fontFamily: MONO,
          fontSize: 26,
          color: '#fff',
        }}
      >
        ⌕ {q.slice(0, n)}
        <span style={{ opacity: n < q.length ? 1 : 0 }}>|</span>
      </div>
      {[0, 1].map((i) => {
        const e = useEnter(44 + i * 18);
        return (
          <div
            key={i}
            style={{
              height: 52,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              opacity: e.opacity,
              transform: `translateY(${e.y}px)`,
            }}
          />
        );
      })}
    </div>
  );
};

export const FeatureVisual: React.FC<{ visual: Visual }> = ({ visual }) => {
  switch (visual) {
    case 'chat':
      return <ChatVisual />;
    case 'wave':
      return <WaveVisual />;
    case 'upload':
      return <UploadVisual />;
    case 'checks':
      return <ChecksVisual />;
    case 'tasks':
      return <TasksVisual />;
    case 'mail':
      return <MailVisual />;
    case 'bell':
      return <BellVisual />;
    case 'admin':
      return <AdminVisual />;
    case 'devices':
      return <DevicesVisual />;
    case 'search':
      return <SearchVisual />;
  }
};
