<script lang="ts">
  /**
   * MicToText — dictation mic button for the composer.
   *
   * Records in rolling 20-second windows using MediaRecorder. Each chunk is
   * immediately POSTed to /api/transcribe/voice; the returned text is appended
   * to the parent's `body` binding via `ontext`.
   *
   * Design decisions:
   *   - No Web Speech API: audio goes to /api/transcribe/voice on our server only.
   *   - 20-second timeslice on MediaRecorder; if the browser does not fire
   *     ondataavailable for timeslices, we restart the recorder loop manually.
   *   - ESC cancels and discards any in-flight chunk.
   *   - Button is hidden when getUserMedia is unavailable (old browser / HTTP context).
   *   - Disabled while `sending` (parent prop) or while the voice-message recorder
   *     (Phase 1) is active (signalled via the `voiceRecorderActive` prop).
   *
   * WebKit bug note: on iOS third-party browsers (Chrome iOS, Firefox iOS),
   * getUserMedia returns a silent track. The VoiceRecorder component handles the
   * "Open in Safari" hint for that flow; here we do the same RMS check.
   */

  type Props = {
    /** Called with each transcribed chunk; caller appends to textarea body. */
    ontext: (text: string) => void;
    /** Disable while the parent is sending a message. */
    sending: boolean;
    /** Disable while the phase-1 voice-message recorder is open. */
    voiceRecorderActive: boolean;
    /** Borderless icon button, used inside the compact phone composer pill. */
    bare?: boolean;
  };

  const { ontext, sending, voiceRecorderActive, bare = false }: Props = $props();

  // ── state ──────────────────────────────────────────────────────────────────
  let active = $state(false);
  let transcribing = $state(false);
  let showSafariHint = $state(false);
  let errorMsg = $state<string | null>(null);

  // ── refs ───────────────────────────────────────────────────────────────────
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let cancelled = false;
  let pendingChunks: Blob[] = [];
  let mimeType = '';
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let audioCtx: AudioContext | null = null;
  let analyserNode: AnalyserNode | null = null;

  // ── MIME negotiation (same priority list as VoiceRecorder) ─────────────────
  const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    ''
  ];

  function pickMime(): string {
    for (const m of MIME_CANDIDATES) {
      if (m === '' || MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  // ── silent track detector (iOS third-party browser guard) ─────────────────
  function scheduleRmsCheck() {
    silenceTimer = setTimeout(() => {
      if (!analyserNode) return;
      const data = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSq += v * v;
      }
      if (Math.sqrt(sumSq / data.length) < 0.001) {
        showSafariHint = true;
      }
    }, 500);
  }

  // ── recording ──────────────────────────────────────────────────────────────

  async function start() {
    errorMsg = null;
    showSafariHint = false;
    cancelled = false;
    pendingChunks = [];
    mimeType = pickMime();

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException)?.name ?? '';
      console.error('[mic-to-text] getUserMedia failed:', err);
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        errorMsg =
          'Microphone access was blocked. Open browser settings for this site and allow microphone, then try again.';
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        errorMsg = 'No microphone was detected on this device.';
      } else if (name === 'NotReadableError') {
        errorMsg = 'The microphone is in use by another app.';
      } else {
        errorMsg = `Could not start dictation (${name || 'unknown error'}).`;
      }
      return;
    }

    // RMS silence check via AnalyserNode.
    audioCtx = new AudioContext();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    audioCtx.createMediaStreamSource(stream).connect(analyserNode);
    scheduleRmsCheck();

    active = true;
    spawnRecorder();
  }

  /**
   * Spawn one MediaRecorder with a 20-second timeslice. When the
   * timeslice fires (ondataavailable), we POST the chunk and restart.
   * If the browser never fires timeslice events, onstop still collects
   * the full chunk on stop().
   */
  function spawnRecorder() {
    if (!stream || cancelled) return;

    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    if (!mimeType) mimeType = r.mimeType;
    recorder = r;

    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    r.onstop = () => {
      if (cancelled) return;
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      sendChunk(blob);
    };

    // 20-second timeslice: browser fires ondataavailable at this interval.
    r.start(20_000);

    // Manual restart after 20s to flush the chunk and start fresh.
    // This handles browsers that don't support timeslice well (some Safari).
    setTimeout(() => {
      if (!cancelled && r.state !== 'inactive') {
        r.stop(); // triggers onstop → sendChunk → spawnRecorder
      }
    }, 20_500);
  }

  async function sendChunk(blob: Blob) {
    if (cancelled) return;

    transcribing = true;
    try {
      const form = new FormData();
      form.append('audio', blob, 'chunk.webm');
      const res = await fetch('/api/transcribe/voice', { method: 'POST', body: form });
      if (cancelled) return; // user stopped while we were waiting
      if (res.ok) {
        const j = await res.json() as { text?: string };
        const text = (j.text ?? '').trim();
        if (text) {
          // Append with a leading space so words don't merge.
          ontext(text.startsWith(' ') ? text : ` ${text}`);
        }
      } else {
        const msg = await res.text().catch(() => 'Transcription failed');
        errorMsg = msg.slice(0, 120);
      }
    } catch {
      if (!cancelled) errorMsg = 'Network error during transcription.';
    } finally {
      transcribing = false;
      // Spawn next recorder window if still recording.
      if (!cancelled && active) spawnRecorder();
    }
  }

  function stop() {
    active = false;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop(); // flushes last chunk via onstop
    }
    teardown();
  }

  function cancel() {
    cancelled = true;
    active = false;
    transcribing = false;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null; // discard
      recorder.stop();
    }
    teardown();
    errorMsg = null;
  }

  function teardown() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyserNode = null;
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    recorder = null;
  }

  // ── ESC cancels dictation ─────────────────────────────────────────────────
  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && active) {
        e.stopPropagation();
        cancel();
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true });
      if (active) cancel();
    };
  });

  const disabled = $derived(sending || voiceRecorderActive);
</script>

<!-- Only render if getUserMedia is available. The parent already guards this,
     but an extra check here prevents the button from appearing in SSR. -->
{#if typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'}
  <div class="flex items-center gap-1.5">
    <button
      type="button"
      class="btn shrink-0 {bare ? 'btn-ghost' : ''}"
      style="{bare ? 'height:40px; width:40px; border-radius:9999px; border-color: transparent;' : 'height:38px; width:38px;'} padding:0;
             {active ? 'background: var(--accent-wash-strong); border-color: var(--accent-line);' : ''}"
      aria-label={active ? 'Stop dictation' : 'Dictate message (mic to text)'}
      aria-pressed={active}
      {disabled}
      onclick={() => { active ? stop() : start(); }}
      title={disabled && voiceRecorderActive ? 'Stop the voice recorder first' : 'Dictate'}
    >
      {#if active && transcribing}
        <!-- Spinner while a chunk is being transcribed -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" class="animate-spin" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      {:else if active}
        <!-- Recording indicator: pulsing mic -->
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
             class="animate-pulse">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      {:else}
        <!-- Speech-bubble + wand glyph to distinguish from the voice-message mic -->
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <line x1="9" y1="10" x2="15" y2="10" />
          <line x1="9" y1="14" x2="13" y2="14" />
        </svg>
      {/if}
    </button>

    {#if active}
      <!-- "Transcribing…" / "Listening…" chip -->
      <span class="text-xs" style="color: var(--color-fainter);" aria-live="polite">
        {transcribing ? 'Transcribing…' : 'Listening…'}
      </span>
      <!-- ESC hint -->
      <kbd class="text-[10px] px-1 py-0.5 rounded font-mono"
           style="background: oklch(0 0 0 / 0.15); color: var(--color-fainter);">Esc</kbd>
    {/if}

    {#if errorMsg}
      <span class="text-xs" style="color: var(--color-danger, #ef4444);" role="alert">
        {errorMsg}
      </span>
    {/if}

    {#if showSafariHint}
      <span class="text-xs" style="color: var(--color-warn);">
        No audio detected. On iOS, open in <strong>Safari</strong> for mic access.
      </span>
    {/if}
  </div>
{/if}
