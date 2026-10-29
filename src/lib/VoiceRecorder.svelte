<script lang="ts">
  /**
   * VoiceRecorder — records audio from the user's microphone and emits a
   * { blob, mimeType, durationMs } event when the user stops.
   *
   * Constraints:
   *   - No Web Speech API (audio must never leave the device via browser API).
   *   - Hard cap: MAX_DURATION_MS = 120 000 ms.
   *   - Stops recording on page visibilitychange → 'hidden' (iOS/Android bug).
   *   - Always releases the mic track on teardown so iOS re-routes audio out.
   *   - Live level meter drawn on a <canvas> with requestAnimationFrame.
   *   - Surfaces "Open in Safari" hint when third-party iOS browser returns
   *     silent audio (zero RMS in the first 500 ms).
   *
   * Parent receives a `onrecorded` callback prop with { blob, mimeType, durationMs }.
   * Parent receives `oncancel` callback when the user clicks X.
   */

  const MAX_DURATION_MS = 120_000;

  // MIME type candidates, checked in order via MediaRecorder.isTypeSupported().
  const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    ''
  ];

  type RecordedPayload = {
    blob: Blob;
    mimeType: string;
    durationMs: number;
    /** True when the user pressed the round send button of the compact bar. */
    send?: boolean;
  };

  type Props = {
    onrecorded: (payload: RecordedPayload) => void;
    oncancel: () => void;
    /**
     * Compact chat-app bar (trash, red dot + timer + level, round send button)
     * used on phones. It starts recording as soon as `start()` is called by
     * the parent, and its send button stops the recording and asks the parent
     * to send it straight away.
     */
    bar?: boolean;
  };

  const { onrecorded, oncancel, bar = false }: Props = $props();

  /** Begin recording (called by the parent from the tap that opened the bar). */
  export function start(): Promise<void> {
    return startRecording();
  }

  // ── state ──────────────────────────────────────────────────────────────────
  let recording = $state(false);
  let startedAt = $state(0);
  let elapsed = $state(0);            // ms since recording started
  /** True while the microphone delivers nothing but digital silence. */
  let silentWarning = $state(false);
  let peakRms = 0;
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const silentMessage = isIOS
    ? 'No sound detected. On iPhone, allow the microphone for this site (or open Hilo in Safari), then try again.'
    : 'No sound detected. Check that your microphone is on, allowed for this site and selected as the input device.';
  /**
   * Human-readable explanation surfaced when getUserMedia or MediaRecorder
   * setup throws. Previously this branch was a silent `catch {}` — the
   * button appeared dead to the user. Now we map the common DOMException
   * names to plain text the composer can render.
   */
  let errorMsg = $state<string | null>(null);

  // ── refs (not reactive — just DOM nodes and mutable objects) ──────────────
  let canvasEl: HTMLCanvasElement | null = $state(null);

  let sendAfter = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId: number | null = null;
  let chunks: Blob[] = [];
  let mimeType = '';
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceCheckTimer: ReturnType<typeof setTimeout> | null = null;

  // ── helpers ───────────────────────────────────────────────────────────────

  function pickMime(): string {
    for (const m of MIME_CANDIDATES) {
      if (m === '' || MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  function formatDuration(ms: number): string {
    const total = Math.floor(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  // ── level meter ──────────────────────────────────────────────────────────

  function startMeter(src: MediaStreamAudioSourceNode, ctx: AudioContext) {
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.6;
    src.connect(an);
    analyser = an;
    drawMeter();
  }

  function drawMeter() {
    rafId = requestAnimationFrame(drawMeter);
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);

    // Loudest level seen so far, used to warn about a muted microphone.
    let peakSumSq = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      peakSumSq += v * v;
    }
    peakRms = Math.max(peakRms, Math.sqrt(peakSumSq / data.length));
    if (!canvasEl) return;

    const ctx2d = canvasEl.getContext('2d');
    if (!ctx2d) return;
    const w = canvasEl.width;
    const h = canvasEl.height;

    // Clear with a very dark background matching the app's glass surface.
    ctx2d.clearRect(0, 0, w, h);

    // Compute RMS for the level.
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / data.length);
    const level = Math.min(1, rms * 6); // scale up so quiet audio is visible

    // Draw a centred bar representing the level.
    const barH = Math.max(3, level * h);
    const yStart = (h - barH) / 2;
    // Use the accent colour variable. Canvas can't read CSS vars directly,
    // so we use a hard-coded violet that matches the default --color-accent.
    ctx2d.fillStyle = `oklch(0.74 0.18 295 / ${0.4 + level * 0.6})`;
    ctx2d.beginPath();
    ctx2d.roundRect(w / 2 - 4, yStart, 8, barH, 4);
    ctx2d.fill();

    // Also draw mini side bars for a richer meter look.
    const sideH = Math.max(2, level * h * 0.6);
    const sy = (h - sideH) / 2;
    ctx2d.fillStyle = `oklch(0.74 0.18 295 / ${0.2 + level * 0.4})`;
    ctx2d.beginPath();
    ctx2d.roundRect(w / 2 - 14, sy, 6, sideH, 3);
    ctx2d.roundRect(w / 2 + 8, sy, 6, sideH, 3);
    ctx2d.fill();
  }

  function stopMeter() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (canvasEl) {
      const ctx2d = canvasEl.getContext('2d');
      ctx2d?.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
  }

  // ── silent-microphone detector ─────────────────────────────────────────────
  // A muted, blocked or wrongly selected microphone still records, but only
  // digital silence. After 1.5 s with nothing above the noise floor we say so
  // (it clears by itself if sound arrives), so nobody sends an empty message.

  function scheduleSilenceCheck() {
    peakRms = 0;
    silentWarning = false;
    silenceCheckTimer = setInterval(() => {
      if (!analyser || !recording) return;
      // A suspended audio context (iOS) reads as silence: do not warn then.
      if (audioCtx?.state !== 'running') return;
      silentWarning = Date.now() - startedAt > 1500 && peakRms < 0.0005;
    }, 500) as unknown as ReturnType<typeof setTimeout>;
  }

  // ── recording lifecycle ───────────────────────────────────────────────────

  async function startRecording() {
    silentWarning = false;
    errorMsg = null;
    sendAfter = false;
    chunks = [];
    mimeType = pickMime();

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // Map the common DOMException names to plain text and bubble the
      // exact error to the console so prod issues are debuggable. The
      // previous silent catch made the button feel completely broken.
      const name = (err as DOMException)?.name ?? '';
      console.error('[voice-recorder] getUserMedia failed:', err);
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        errorMsg =
          'Microphone access was blocked. Open browser settings for this site and allow microphone, then try again.';
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        errorMsg = 'No microphone was detected on this device.';
      } else if (name === 'NotReadableError') {
        errorMsg = 'The microphone is in use by another app. Close it and try again.';
      } else {
        errorMsg = `Could not start recording (${name || 'unknown error'}).`;
      }
      return;
    }

    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    startMeter(src, audioCtx);
    scheduleSilenceCheck();

    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mimeType = recorder.mimeType; // normalise to whatever the UA actually uses

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const durationMs = Date.now() - startedAt;
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      teardown();
      onrecorded({ blob, mimeType: mimeType || 'audio/webm', durationMs, send: sendAfter });
    };

    recorder.start(1000); // 1-second chunks
    startedAt = Date.now();
    recording = true;
    elapsed = 0;

    elapsedTimer = setInterval(() => {
      elapsed = Date.now() - startedAt;
    }, 200);

    // Hard cap: auto-stop at 120 s.
    maxTimer = setTimeout(() => {
      if (recording) stopRecording();
    }, MAX_DURATION_MS);
  }

  function stopAndSend() {
    sendAfter = true;
    stopRecording();
  }

  function stopRecording() {
    if (!recorder || recorder.state === 'inactive') return;
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
    if (silenceCheckTimer) { clearInterval(silenceCheckTimer); silenceCheckTimer = null; }
    recording = false;
    recorder.stop(); // triggers onstop async
  }

  function cancel() {
    if (recording) {
      // Override onstop to discard instead of emit.
      if (recorder) recorder.onstop = null;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      recording = false;
    }
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
    if (silenceCheckTimer) { clearInterval(silenceCheckTimer); silenceCheckTimer = null; }
    teardown();
    oncancel();
  }

  function teardown() {
    stopMeter();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;
    recorder = null;
  }

  // ── page visibility guard (iOS/Android background-chunk bug) ──────────────

  $effect(() => {
    function onVisChange() {
      if (document.visibilityState === 'hidden' && recording) {
        stopRecording();
      }
    }
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      // Cleanup on component destroy.
      if (recording) cancel();
    };
  });
</script>

{#if bar}
  <div class="flex flex-col gap-1.5" data-testid="voice-bar">
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="btn btn-ghost shrink-0 btn-xl btn-icon btn-round"
        onclick={cancel}
        aria-label="Cancel recording"
        data-testid="voice-cancel"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>

      <div
        class="flex-1 min-w-0 flex items-center gap-2.5 px-4"
        style="height:44px; border-radius:9999px; border:1px solid var(--glass-border); background: oklch(0 0 0 / 0.2);"
      >
        {#if recording}
          <span class="shrink-0 rounded-full animate-pulse" style="width:10px; height:10px; background: oklch(0.65 0.24 25);" aria-hidden="true"></span>
          <span class="font-mono text-[15px] tabular-nums" aria-live="polite" aria-label="Recording duration" data-testid="voice-timer">
            {formatDuration(elapsed)}
          </span>
          {#if elapsed >= MAX_DURATION_MS - 5000}
            <span class="text-xs" style="color: var(--color-warn);" aria-live="assertive">max</span>
          {/if}
          <canvas bind:this={canvasEl} width="96" height="38" class="ml-auto shrink-0" aria-hidden="true"></canvas>
        {:else if errorMsg}
          <span class="text-xs truncate" style="color: var(--color-danger);">Could not record</span>
        {:else}
          <span class="text-sm text-muted">Starting the microphone…</span>
        {/if}
      </div>

      <button
        type="button"
        class="btn btn-primary shrink-0 btn-xl btn-icon btn-round"
        onclick={stopAndSend}
        disabled={!recording}
        aria-label="Send voice message"
        data-testid="voice-send"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>

    {#if silentWarning}
      <p class="text-xs px-1" style="color: var(--color-warn);" role="alert" data-testid="voice-silent-warning">
        {silentMessage}
      </p>
    {/if}
    {#if errorMsg}
      <p class="text-xs px-1" style="color: var(--color-danger);" role="alert">{errorMsg}</p>
    {/if}
  </div>
{:else}
<div class="flex flex-col gap-2">
  <div class="flex items-center gap-2">
    {#if !recording}
      <!-- Start button -->
      <button
        type="button"
        class="btn btn-primary"
        onclick={startRecording}
        aria-label="Start recording"
      >
        <!-- Mic icon -->
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        Record voice
      </button>
    {:else}
      <!-- Level meter canvas -->
      <canvas
        bind:this={canvasEl}
        width="40"
        height="38"
        class="shrink-0"
        aria-hidden="true"
      ></canvas>

      <!-- Duration counter -->
      <span class="font-mono text-sm tabular-nums" style="min-width: 44px;"
            aria-live="polite" aria-label="Recording duration">
        {formatDuration(elapsed)}
        {#if elapsed >= MAX_DURATION_MS - 5000}
          <span class="text-xs ml-1" style="color: var(--color-warn);" aria-live="assertive">max</span>
        {/if}
      </span>

      <!-- Stop / send button -->
      <button
        type="button"
        class="btn btn-primary"
        onclick={stopRecording}
        aria-label="Stop recording and attach"
      >
        <!-- Stop square -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
        Stop
      </button>

      <!-- Cancel / discard button -->
      <button
        type="button"
        class="btn btn-ghost btn-icon"
        onclick={cancel}
        aria-label="Cancel recording"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    {/if}
  </div>

  {#if silentWarning}
    <p class="text-xs" style="color: var(--color-warn);" role="alert" data-testid="voice-silent-warning">
      {silentMessage}
    </p>
  {/if}

  {#if errorMsg}
    <p class="text-xs" style="color: var(--color-danger);" role="alert">
      {errorMsg}
    </p>
  {/if}
</div>
{/if}
