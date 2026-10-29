<script lang="ts">
  import { fade } from 'svelte/transition';
  import { onMount } from 'svelte';

  type Props = {
    src: string;
    alt: string;
    onclose: () => void;
  };

  const { src, alt, onclose }: Props = $props();

  const MIN_SCALE = 1;
  const DOUBLE_TAP_SCALE = 2.5;
  const TAP_MAX_MS = 300;
  const TAP_MAX_MOVE = 10;
  const BUTTON_STEP = 1.6;

  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let maxScale = $state(4);
  let gesturing = $state(false);

  let closeBtn = $state<HTMLButtonElement | null>(null);
  let stage = $state<HTMLDivElement | null>(null);
  let img = $state<HTMLImageElement | null>(null);

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; scale: number } | null = null;
  let tapStart: { x: number; y: number; t: number } | null = null;
  let lastTap: { x: number; y: number; t: number } | null = null;
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingClose = false;

  // Portal to <body>: ancestors with backdrop-filter/transform would otherwise
  // clamp this fixed overlay to their own box.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  // wheel must be non-passive so preventDefault stops the page from scrolling.
  function wheelAction(node: HTMLElement) {
    node.addEventListener('wheel', onWheel, { passive: false });
    return { destroy() { node.removeEventListener('wheel', onWheel); } };
  }

  function clamp(n: number, lo: number, hi: number) {
    return Math.min(hi, Math.max(lo, n));
  }

  /** Point relative to the stage centre (the transform origin). */
  function rel(x: number, y: number) {
    const r = stage!.getBoundingClientRect();
    return { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) };
  }

  function clampPan() {
    if (!stage || !img) return;
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    tx = clamp(tx, -maxX, maxX);
    ty = clamp(ty, -maxY, maxY);
  }

  /** Zoom to `next`, keeping the point (cx, cy) (centre-relative) fixed on screen. */
  function zoomAt(cx: number, cy: number, next: number) {
    const target = clamp(next, MIN_SCALE, maxScale);
    const k = target / scale;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    scale = target;
    if (scale === MIN_SCALE) {
      tx = 0;
      ty = 0;
    } else {
      clampPan();
    }
  }

  function resetZoom() {
    scale = MIN_SCALE;
    tx = 0;
    ty = 0;
  }

  function onImgLoad() {
    if (!img) return;
    maxScale = clamp((img.naturalWidth / Math.max(1, img.offsetWidth)) * 2, 4, 8);
  }

  function overImage(x: number, y: number) {
    if (!img) return false;
    const r = img.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function onPointerDown(e: PointerEvent) {
    stage!.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesturing = true;
    if (pointers.size === 1) {
      tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
      tapStart = null;
    }
  }

  function onPointerMove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };

    if (pointers.size === 2 && pinch) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
      const mid = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
      pointers.set(e.pointerId, cur);
      tx += mid.x - prevMid.x;
      ty += mid.y - prevMid.y;
      const dist = Math.hypot(cur.x - other.x, cur.y - other.y) || 1;
      const c = rel(mid.x, mid.y);
      zoomAt(c.x, c.y, pinch.scale * (dist / pinch.dist));
      return;
    }

    pointers.set(e.pointerId, cur);
    if (tapStart && Math.hypot(cur.x - tapStart.x, cur.y - tapStart.y) > TAP_MAX_MOVE) {
      tapStart = null;
    }
    if (pointers.size === 1 && scale > MIN_SCALE) {
      tx += cur.x - prev.x;
      ty += cur.y - prev.y;
      clampPan();
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size > 0) return;
    gesturing = false;

    const tap = tapStart;
    tapStart = null;
    if (e.type !== 'pointerup' || !tap || Date.now() - tap.t > TAP_MAX_MS) return;

    if (!overImage(tap.x, tap.y)) {
      // Close from the click that follows this pointerup, not from the
      // pointerup itself: closing earlier lets the synthesized click land on
      // the page underneath once the overlay is gone. The timer is a fallback
      // for browsers that do not emit a click.
      pendingClose = true;
      closeTimer = setTimeout(finishPendingClose, 500);
      return;
    }
    const isDouble =
      lastTap &&
      tap.t - lastTap.t < TAP_MAX_MS * 1.5 &&
      Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 30;
    if (isDouble) {
      lastTap = null;
      if (scale > MIN_SCALE) resetZoom();
      else {
        const c = rel(tap.x, tap.y);
        zoomAt(c.x, c.y, DOUBLE_TAP_SCALE);
      }
    } else {
      lastTap = tap;
    }
  }

  function finishPendingClose() {
    if (!pendingClose) return;
    pendingClose = false;
    if (closeTimer) clearTimeout(closeTimer);
    onclose();
  }

  function onStageClick(e: MouseEvent) {
    if (!pendingClose) return;
    e.preventDefault();
    e.stopPropagation();
    finishPendingClose();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    gesturing = true;
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => (gesturing = false), 120);
    const c = rel(e.clientX, e.clientY);
    const speed = e.ctrlKey ? 0.01 : 0.002;
    zoomAt(c.x, c.y, scale * Math.exp(-e.deltaY * speed));
  }

  function step(factor: number) {
    zoomAt(0, 0, scale * factor);
  }

  onMount(() => {
    closeBtn?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onclose();
      } else if (e.key === '+' || e.key === '=') {
        step(BUTTON_STEP);
      } else if (e.key === '-' || e.key === '_') {
        step(1 / BUTTON_STEP);
      } else if (e.key === '0') {
        resetZoom();
      }
    }
    // iOS Safari fires its own gesture events for pinch; keep them from zooming the page.
    const stopGesture = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', onKeydown, { capture: true });
    stage?.addEventListener('gesturestart', stopGesture);
    stage?.addEventListener('gesturechange', stopGesture);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeydown, { capture: true });
      stage?.removeEventListener('gesturestart', stopGesture);
      stage?.removeEventListener('gesturechange', stopGesture);
      if (wheelTimer) clearTimeout(wheelTimer);
      if (closeTimer) clearTimeout(closeTimer);
    };
  });
</script>

<div
  use:portal
  class="fixed inset-0 z-[300]"
  style="background: oklch(0 0 0 / 0.92);"
  role="dialog"
  aria-modal="true"
  aria-label={alt}
  transition:fade={{ duration: 140 }}
>
  <div
    bind:this={stage}
    use:wheelAction
    role="presentation"
    class="absolute inset-0 flex items-center justify-center overflow-hidden select-none"
    style="touch-action: none; cursor: {scale > MIN_SCALE ? 'grab' : 'zoom-in'};"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onclick={onStageClick}
  >
    <img
      bind:this={img}
      {src}
      {alt}
      onload={onImgLoad}
      class="block rounded-lg"
      style="max-width: 100vw; max-height: 100dvh; width: auto; height: auto; object-fit: contain; transform: translate3d({tx}px, {ty}px, 0) scale({scale}); transform-origin: center; will-change: transform; transition: {gesturing ? 'none' : 'transform 160ms ease-out'}; -webkit-user-drag: none; -webkit-touch-callout: none;"
      draggable="false"
    />
  </div>

  <div
    class="absolute z-20 flex items-center gap-2"
    style="top: calc(0.75rem + env(safe-area-inset-top, 0px)); right: calc(0.75rem + env(safe-area-inset-right, 0px));"
  >
    <button
      type="button"
      class="btn btn-ghost"
      style="height: 44px; width: 44px; padding: 0; border-radius: 999px; background: oklch(0 0 0 / 0.55);"
      aria-label="Zoom out"
      title="Zoom out"
      disabled={scale <= MIN_SCALE}
      onclick={() => step(1 / BUTTON_STEP)}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
    <button
      type="button"
      class="btn btn-ghost"
      style="height: 44px; width: 44px; padding: 0; border-radius: 999px; background: oklch(0 0 0 / 0.55);"
      aria-label="Zoom in"
      title="Zoom in"
      disabled={scale >= maxScale}
      onclick={() => step(BUTTON_STEP)}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
    <a
      href={src}
      download={alt}
      class="btn btn-ghost"
      style="height: 44px; width: 44px; padding: 0; border-radius: 999px; background: oklch(0 0 0 / 0.55);"
      aria-label="Download image"
      title="Download"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
    <button
      bind:this={closeBtn}
      type="button"
      class="btn btn-ghost"
      style="height: 44px; width: 44px; padding: 0; border-radius: 999px; background: oklch(0 0 0 / 0.55);"
      aria-label="Close image"
      title="Close"
      onclick={onclose}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  </div>
</div>
