<script lang="ts">
  /**
   * Message composer: textarea, drag-and-drop attachments, admin-only
   * "internal note" toggle, template dropdown, send button.
   *
   * The component is presentation + local state only. The parent owns:
   *   - `body` / `pendingFiles` / `asInternal` (bound)
   *   - `send()` / `pingTyping()` / `applyTemplate()` callbacks
   *   - `error` and `sending` flags
   *   - `replyingTo` / `onCancelReply` for threaded reply mode
   *
   * Sprint 33: Chunked upload tracking is now owned here.
   *   - `isChunkedUploading` (bindable bool) — true while any large file
   *     is in the queued|uploading|paused|completing state. The parent
   *     should disable Send while this is true.
   *   - `chunkedUploadSessionIds` (bindable string[]) — upload session ids
   *     of completed chunked uploads. The parent appends these to the
   *     FormData as `upload_session_ids` when sending.
   */
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onMount, tick } from 'svelte';
  import { fmtBytes } from '$lib/format';
  import VoiceRecorder from '$lib/VoiceRecorder.svelte';
  import MicToText from '$lib/MicToText.svelte';
  import AudioPreviewChip from '$lib/AudioPreviewChip.svelte';
  import VideoPreviewChip from '$lib/VideoPreviewChip.svelte';
  import { shouldUseChunked, startChunkedUpload, type UploadHandle } from '$lib/uploads';
  import { untrack } from 'svelte';

  type ReplyingTo = { id: number; sender_email: string; body: string };

  type Props = {
    body: string;
    pendingFiles: File[];
    asInternal: boolean;
    isAdmin: boolean;
    sending: boolean;
    error: string | null;
    ticketId: number;
    replyingTo?: ReplyingTo | null;
    textareaRef?: HTMLTextAreaElement | null;
    /** True while at least one chunked upload is in-flight. Bind to block Send. */
    isChunkedUploading?: boolean;
    /** Upload session ids for completed chunked uploads. Bind to read in parent send(). */
    chunkedUploadSessionIds?: string[];
    onSend: () => void;
    onTyping: () => void;
    onApplyTemplate: (text: string) => void;
    onCancelReply?: () => void;
  };

  let {
    body = $bindable(),
    pendingFiles = $bindable(),
    asInternal = $bindable(),
    isAdmin,
    sending,
    error,
    ticketId,
    replyingTo = null,
    textareaRef = $bindable(null),
    isChunkedUploading = $bindable(false),
    chunkedUploadSessionIds = $bindable([]),
    onSend,
    onTyping,
    onApplyTemplate,
    onCancelReply
  }: Props = $props();

  let dragging = $state(false);
  let showRecorder = $state(false);
  let recorderRef = $state<{ start: () => Promise<void> } | null>(null);

  // Phones get the compact chat-app layout (rounded field, one round button
  // that is a mic when empty and a send arrow otherwise). Tracked in JS only
  // for things CSS cannot express (recorder bar, placeholder); the layout
  // itself switches with CSS so the first paint is already right.
  let isMobile = $state(false);
  onMount(() => {
    const mq = window.matchMedia('(max-width: 639.98px)');
    isMobile = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (isMobile = e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  const hasContent = $derived(body.trim().length > 0 || pendingFiles.length > 0);
  const canRecord = () =>
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

  /** Phone mic tap: open the recording bar and start straight away. */
  async function startVoiceOnPhone() {
    showRecorder = true;
    await tick();
    await recorderRef?.start();
  }

  // ── Chunked upload tracking ───────────────────────────────────────────────

  /**
   * Map from File to its live UploadHandle (plain object from uploads.ts).
   * This is NOT rendered directly — use `snapshots` for the template.
   *
   * Non-reactive: we never assign this directly from $state; it's a private
   * registry managed imperatively.
   */
  let handles: Map<File, UploadHandle> = new Map();

  /**
   * Reactive snapshot map — new object reference per-file on every callback.
   * The template reads from this so Svelte's fine-grained reactivity picks
   * up status changes even though the underlying handle objects are plain.
   */
  type Snapshot = {
    id: string;
    status: import('$lib/uploads').UploadStatus;
    bytesUploaded: number;
    bytesTotal: number;
    storedName?: string;
    errorMsg?: string;
    handle: UploadHandle;
  };
  let snapshots = $state(new Map<File, Snapshot>());

  // Derived values from snapshots (reactive, used by parent bindings + template).
  const _isChunkedUploading: boolean = $derived(
    Array.from(snapshots.values()).some((s) =>
      ['queued', 'uploading', 'paused', 'completing'].includes(s.status)
    )
  );
  const _chunkedSessionIds: string[] = $derived(
    Array.from(snapshots.values())
      .filter((s) => s.status === 'done' && s.id)
      .map((s) => s.id)
  );

  $effect(() => { isChunkedUploading = _isChunkedUploading; });
  $effect(() => { chunkedUploadSessionIds = _chunkedSessionIds; });

  /** Take a new snapshot of a handle and push it into the reactive map. */
  function snap(file: File, handle: UploadHandle): void {
    const current = untrack(() => snapshots);
    const next = new Map(current);
    next.set(file, {
      id: handle.id,
      status: handle.status,
      bytesUploaded: handle.bytesUploaded,
      bytesTotal: handle.bytesTotal,
      storedName: handle.storedName,
      errorMsg: handle.errorMsg,
      handle
    });
    snapshots = next;
  }

  /**
   * When pendingFiles changes, auto-start chunked uploads for new large files
   * and remove handles for files that were removed from the list.
   */
  $effect(() => {
    const files = pendingFiles; // reactive dependency: only pendingFiles

    // Start uploads for new large files.
    for (const file of files) {
      if (shouldUseChunked(file) && !handles.has(file)) {
        const handle = startChunkedUpload({
          file,
          ticketId,
          onProgress(h) { snap(file, h); },
          onComplete(h) { snap(file, h); },
          onError(h) { snap(file, h); }
        });
        handles.set(file, handle);
        snap(file, handle);
      }
    }

    // Abort and remove handles for files no longer in pendingFiles.
    for (const [file, handle] of handles) {
      if (!files.includes(file)) {
        if (handle.status !== 'done' && handle.status !== 'aborted') {
          handle.abort();
        }
        handles.delete(file);
        // Release the speed-sample entry so it does not accumulate across
        // remount cycles when files are repeatedly added and removed.
        speedSamples.delete(file);
        const current = untrack(() => snapshots);
        const next = new Map(current);
        next.delete(file);
        snapshots = next;
      }
    }
  });

  // ── Previous-upload banner ────────────────────────────────────────────────

  /**
   * Orphaned tus localStorage entry: a previous upload that did not complete
   * before the page was reloaded. We cannot resume without the original File
   * object (tus fingerprint requires name + size + lastModified + type to
   * match). Instead, we surface a notice so the user can discard the stale
   * entry or re-select the file manually.
   */
  type OrphanEntry = { key: string; filename: string; uploadId: string };

  let orphanEntries = $state<OrphanEntry[]>([]);

  onMount(async () => {
    if (typeof localStorage === 'undefined') return;

    // 1. Collect candidates from localStorage (same fingerprint logic as before).
    const candidates: OrphanEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('tus::tus-br-')) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key) ?? 'null') as {
          uploadUrl?: string;
        } | null;
        if (!entry?.uploadUrl) continue;
        // Only surface entries for this server's upload endpoint.
        const match = /\/api\/uploads\/([^/]+)$/.exec(entry.uploadUrl);
        if (!match) continue;
        const uploadId = match[1];
        // Parse the filename from the fingerprint key.
        // Key format: tus::tus-br-<name>-<type>-<size>-<lastModified>-<endpoint>::<id>
        const fingerprintPart = key.replace(/^tus::/, '').replace(/::\d+$/, '');
        // fingerprintPart = "tus-br-<name>-<type>-<size>-<lastModified>-<endpoint>"
        const withoutPrefix = fingerprintPart.replace(/^tus-br-/, '');
        // The first segment before the mime-type prefix (e.g. "video/", "application/")
        // is the filename. Split on "-video/", "-audio/", "-application/", "-image/"
        const mimeMatch = /^(.+?)-(?:video|audio|application|image|text)\//.exec(withoutPrefix);
        const filename = mimeMatch ? mimeMatch[1] : withoutPrefix.split('-')[0] || 'unknown file';
        candidates.push({ key, filename, uploadId });
      } catch {
        // Malformed entry — ignore.
      }
    }

    // 2. HEAD-probe each candidate. The server returns X-Hilo-Ticket-Id so we
    //    can filter to only the current ticket. 404 means the session expired
    //    on the server — silently remove the stale localStorage entry.
    const surviving: OrphanEntry[] = [];
    await Promise.all(
      candidates.map(async (c) => {
        try {
          const resp = await fetch(`/api/uploads/${c.uploadId}`, {
            method: 'HEAD',
            headers: { 'Tus-Resumable': '1.0.0' }
          });
          if (resp.status === 404) {
            // Server session is gone — clean up the stale localStorage entry.
            localStorage.removeItem(c.key);
            return;
          }
          if (!resp.ok) {
            // 401 / 403 / network error — leave the entry alone but do not
            // surface it. The next page load on the correct ticket will re-probe.
            return;
          }
          const sessionTicketId = Number(resp.headers.get('X-Hilo-Ticket-Id'));
          if (Number.isFinite(sessionTicketId) && sessionTicketId === ticketId) {
            surviving.push(c);
          }
        } catch {
          // Network / parse error — leave the entry alone, do not surface.
        }
      })
    );

    orphanEntries = surviving;
  });

  function discardOrphan(entry: OrphanEntry) {
    localStorage.removeItem(entry.key);
    orphanEntries = orphanEntries.filter((e) => e.key !== entry.key);
  }

  function discardAllOrphans() {
    for (const entry of orphanEntries) {
      localStorage.removeItem(entry.key);
    }
    orphanEntries = [];
  }

  // ── MIME inference ────────────────────────────────────────────────────────

  /**
   * Extension → MIME map for the file types Hilo actually renders in the
   * chat bubble or stores meaningfully. Conservative on purpose: SVG is
   * NOT included (XSS surface); unknown extensions fall through to
   * application/octet-stream, which the server allow-list accepts.
   *
   * SOURCE OF TRUTH: keep in sync with EXT_TO_MIME in src/lib/server/uploads.ts.
   */
  const EXT_TO_MIME: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif',
    bmp: 'image/bmp',
    avif: 'image/avif',
    // Video
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    // Audio
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    // Documents
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip'
  };

  function inferMimeType(file: File): string {
    if (file.type) return file.type;
    const dot = file.name.lastIndexOf('.');
    if (dot < 0) return 'application/octet-stream';
    const ext = file.name.slice(dot + 1).toLowerCase();
    return EXT_TO_MIME[ext] ?? 'application/octet-stream';
  }

  /**
   * Normalize every incoming file (infer MIME from extension if empty) and
   * append to pendingFiles. Replaces all direct pendingFiles = [...] spreads
   * so normalization is applied consistently at every ingestion point.
   */
  function addFiles(rawFiles: Iterable<File>) {
    const normalized: File[] = [];
    for (const f of rawFiles) {
      const mime = inferMimeType(f);
      if (mime === f.type) {
        normalized.push(f); // no change needed — keep the original reference
      } else {
        normalized.push(new File([f], f.name, { type: mime, lastModified: f.lastModified }));
      }
    }
    if (normalized.length > 0) pendingFiles = [...pendingFiles, ...normalized];
  }

  // ── Standard drag / file / keyboard handlers ─────────────────────────────

  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dragging = true;
    }
  }
  function onDragLeave() {
    dragging = false;
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (!e.dataTransfer?.files) return;
    addFiles(e.dataTransfer.files);
  }
  function onFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) return;
    addFiles(input.files);
    input.value = '';
  }

  /**
   * Handle clipboard paste events. Attached to the form element only — paste
   * events bubble from the textarea (and any other focused child) up to the form,
   * so a single form-level handler covers all paste targets inside the composer.
   * Attaching it to BOTH the textarea and the form would cause the handler to run
   * twice for textarea paste events (textarea fires → bubbles to form).
   *
   * Extracts file items from the clipboard and normalizes them via addFiles().
   * Mixed text + file paste: let the default text behaviour run (do NOT
   * preventDefault) but still capture the file items.
   * Files-only paste: preventDefault to avoid the browser pasting garbled text.
   */
  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const newFiles: File[] = [];
    let hasString = false;
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) newFiles.push(f);
      } else if (it.kind === 'string') {
        hasString = true;
      }
    }

    if (newFiles.length === 0) return; // no files — let default text-paste run
    // Files only → prevent default to avoid garbled text insertion.
    // Mixed text + files → allow text to also paste at caret position.
    if (!hasString) e.preventDefault();
    addFiles(newFiles);
  }
  function removeFile(i: number) {
    pendingFiles = pendingFiles.filter((_, idx) => idx !== i);
  }
  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSend();
    }
  }

  /**
   * Resize the textarea to match its content, up to the CSS max-height.
   */
  function autoResize() {
    const el = textareaRef;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  $effect(() => {
    void body;
    queueMicrotask(autoResize);
  });

  // ── Progress formatting + speed / ETA ───────────────────────────────────

  /** Per-file bandwidth samples for the 1-second sliding average. */
  const speedSamples = new Map<File, { at: number; bytes: number }>();

  function fmtPercent(handle: UploadHandle): string {
    if (handle.bytesTotal === 0) return '0%';
    return `${Math.round((handle.bytesUploaded / handle.bytesTotal) * 100)}%`;
  }

  /**
   * Compute bytes/sec from a 1-second sliding window sample.
   * Returns 0 if there is no sample yet or the sample is stale.
   */
  function bytesPerSec(handle: UploadHandle): number {
    const prev = speedSamples.get(handle.file);
    const now = Date.now();
    if (!prev) {
      speedSamples.set(handle.file, { at: now, bytes: handle.bytesUploaded });
      return 0;
    }
    const elapsed = (now - prev.at) / 1000;
    if (elapsed < 0.5) return 0; // sample too fresh
    const bps = (handle.bytesUploaded - prev.bytes) / elapsed;
    // Update sample every second.
    if (elapsed >= 1) speedSamples.set(handle.file, { at: now, bytes: handle.bytesUploaded });
    return Math.max(0, bps);
  }

  function fmtEta(handle: UploadHandle): string {
    const bps = bytesPerSec(handle);
    if (bps <= 0) return '';
    const remaining = handle.bytesTotal - handle.bytesUploaded;
    const secs = remaining / bps;
    if (secs < 5) return '< 5 s';
    if (secs < 60) return `~${Math.round(secs)} s`;
    return `~${Math.round(secs / 60)} min`;
  }

  function statusLabel(handle: UploadHandle): string {
    switch (handle.status) {
      case 'queued': return 'Waiting…';
      case 'uploading': {
        const eta = fmtEta(handle);
        return `${fmtBytes(handle.bytesUploaded)} / ${fmtBytes(handle.bytesTotal)} · ${fmtPercent(handle)}${eta ? ` · ${eta} left` : ''}`;
      }
      case 'paused': return `Paused · ${fmtPercent(handle)}`;
      case 'completing': return 'Assembling…';
      case 'done': return `${fmtBytes(handle.bytesTotal)} · Ready`;
      case 'error': return handle.errorMsg ?? 'Upload failed';
      case 'aborted': return 'Cancelled';
    }
  }

  /** True if this handle is being retried (error state but not terminal). */
  function isRetrying(handle: UploadHandle): boolean {
    // tus-js-client will call onProgress again after a retry succeeds;
    // we detect the retry window as: status=error but upload was previously active.
    // Since tus handles retries internally (status stays 'uploading' between retries),
    // we use the errorMsg being set as the reconnecting indicator.
    return handle.status === 'error' && !!handle.errorMsg?.toLowerCase().includes('network');
  }
</script>

<form
  class="border-t p-2 sm:p-4 space-y-2 sm:space-y-2.5 transition-colors"
  style="border-color: var(--glass-border); {dragging ? 'background: var(--accent-wash); border-color: var(--color-accent);' : ''}"
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  onpaste={onPaste}
  onsubmit={(e) => {
    e.preventDefault();
    onSend();
  }}
>
  {#if replyingTo}
    <!-- Reply pill: shows the context being replied to with a cancel button -->
    <div class="flex items-center gap-2 px-3 py-2 rounded-lg border-l-4"
         style="border-color: var(--color-accent); background: var(--accent-wash);"
         in:fly={{ y: -4, duration: 180, easing: cubicOut }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
           class="shrink-0" style="color: var(--color-accent);">
        <polyline points="9 17 4 12 9 7" />
        <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
      </svg>
      <div class="flex-1 min-w-0">
        <div class="text-xs text-muted">Replying to <strong>{replyingTo.sender_email}</strong></div>
        <div class="text-sm truncate text-muted">{replyingTo.body.slice(0, 80)}{replyingTo.body.length > 80 ? '…' : ''}</div>
      </div>
      <button type="button" class="btn btn-ghost shrink-0 btn-xs btn-icon"
              aria-label="Cancel reply"
              onclick={() => onCancelReply?.()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  {/if}

  {#if isAdmin}
    <div class="flex items-center gap-3 text-xs">
      <label class="inline-flex items-center gap-2 cursor-pointer text-muted select-none">
        <input type="checkbox" bind:checked={asInternal} />
        Internal note <span class="text-fainter">(admin-only)</span>
      </label>
      <select
        class="select select-sm w-auto"
        aria-label="Reply templates"
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v) {
            onApplyTemplate(v);
            (e.target as HTMLSelectElement).value = '';
          }
        }}
      >
        <option value="">Templates…</option>
        <option value="Looking into this now — will report back within the hour.">Investigating</option>
        <option value="Closing this out — please reopen if you see it again.">Closing</option>
        <option value="Could you share a screenshot or repro steps? Thanks.">Ask for repro</option>
      </select>
      <span class="ml-auto hidden md:inline-flex items-center gap-1 text-fainter" aria-hidden="true">
        <span class="kbd">Ctrl</span><span class="kbd">Enter</span> to send
      </span>
    </div>
  {/if}

  {#if orphanEntries.length > 0}
    <!--
      Previous-upload notice: one or more tus uploads did not complete before
      the page was reloaded. We cannot resume without the original File object,
      so we show a notice and let the user discard the stale entries or
      re-select the file manually.
    -->
    <div
      class="rounded-xl px-3 py-2 text-xs"
      style="background: var(--accent-wash); border: 1px solid var(--accent-line);"
      in:fly={{ y: -4, duration: 180, easing: cubicOut }}
    >
      <div class="font-medium mb-1">
        {orphanEntries.length === 1
          ? '1 upload did not finish before the page was reloaded'
          : `${orphanEntries.length} uploads did not finish before the page was reloaded`}
      </div>
      <div class="text-fainter mb-1.5">
        To continue, please re-select {orphanEntries.length === 1 ? 'the file' : 'the files'} using the
        attachment button below.
      </div>
      <ul class="space-y-0.5 mb-1.5">
        {#each orphanEntries as entry (entry.key)}
          <li class="flex items-center gap-2">
            <span class="truncate flex-1">{entry.filename}</span>
            <button
              type="button"
              class="text-fainter hover:text-danger underline shrink-0"
              aria-label={`Discard previous upload of ${entry.filename}`}
              onclick={() => discardOrphan(entry)}
            >Discard</button>
          </li>
        {/each}
      </ul>
      {#if orphanEntries.length > 1}
        <button
          type="button"
          class="text-fainter underline"
          onclick={discardAllOrphans}
        >Discard all</button>
      {/if}
    </div>
  {/if}

  {#if pendingFiles.length}
    <!--
      Mixed-mode pending list. Large files (> 95 MB) show a chunked-upload
      progress chip. Audio files use AudioPreviewChip. Video files use
      VideoPreviewChip. Everything else is the compact text chip.
    -->
    <ul class="flex flex-wrap gap-2 items-start">
      {#each pendingFiles as f, i (f)}
        {#if shouldUseChunked(f)}
          {@const snap = snapshots.get(f)}
          <li class="glass-subtle text-xs w-full max-w-xs">
            <!-- Chunked upload progress chip -->
            <div class="px-2.5 pt-2 pb-1">
              <div class="flex items-center justify-between gap-2 mb-1">
                <span class="font-medium truncate" title={f.name}>{f.name}</span>
                <div class="flex items-center gap-1 shrink-0">
                  {#if snap && (snap.status === 'uploading' || snap.status === 'paused')}
                    <!-- Pause/Resume toggle -->
                    <button
                      type="button"
                      class="text-fainter hover:text-current"
                      aria-label={snap.status === 'paused' ? 'Resume upload' : 'Pause upload'}
                      onclick={() => snap.status === 'paused' ? snap.handle.resume() : snap.handle.pause()}
                      style="padding: 2px 4px;"
                    >
                      {#if snap.status === 'paused'}
                        <!-- Play icon -->
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                      {:else}
                        <!-- Pause icon -->
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                        </svg>
                      {/if}
                    </button>
                  {/if}
                  <!-- Cancel -->
                  <button
                    type="button"
                    class="text-fainter hover:text-danger"
                    aria-label={`Cancel upload of ${f.name}`}
                    onclick={() => removeFile(i)}
                    style="padding: 2px 4px; font-size: 14px; line-height: 1;"
                  >×</button>
                </div>
              </div>
              <!-- Progress bar (6 px tall) -->
              {#if snap && snap.status !== 'done' && snap.status !== 'error' && snap.status !== 'aborted'}
                <div class="w-full rounded-full overflow-hidden" style="height:6px; background: oklch(0.3 0 0 / 0.3);">
                  <div
                    class="h-full rounded-full transition-all duration-300"
                    style="width: {snap.bytesTotal > 0 ? Math.round(snap.bytesUploaded / snap.bytesTotal * 100) : 0}%;
                           background: linear-gradient(90deg, var(--color-accent), oklch(0.74 0.22 295));"
                  ></div>
                </div>
              {/if}
              <!-- Status text -->
              <div class="mt-1 text-fainter text-[10px]">
                {snap ? statusLabel(snap.handle) : 'Starting…'}
                {#if snap?.status === 'error'}
                  <button
                    type="button"
                    class="ml-1 text-accent underline"
                    aria-label={`Retry upload of ${f.name}`}
                    onclick={() => snap.handle.retry()}
                  >Retry</button>
                  <button
                    type="button"
                    class="ml-1 text-fainter underline"
                    aria-label={`Dismiss failed upload of ${f.name}`}
                    onclick={() => removeFile(i)}
                  >Dismiss</button>
                {/if}
              </div>
            </div>
          </li>
        {:else if f.type.startsWith('audio/')}
          <li class="glass-subtle px-2.5 py-1 text-xs">
            <AudioPreviewChip file={f} onRemove={() => removeFile(i)} />
          </li>
        {:else if f.type.startsWith('video/')}
          <li class="glass-subtle px-2.5 py-1 text-xs">
            <VideoPreviewChip file={f} onRemove={() => removeFile(i)} />
          </li>
        {:else}
          <li class="glass-subtle px-2.5 py-1 text-xs">
            <span class="inline-flex items-center gap-2">
              <span class="font-medium">{f.name}</span>
              <span class="text-fainter num">{fmtBytes(f.size)}</span>
              <button type="button" class="text-fainter hover:text-danger"
                      aria-label={`Remove ${f.name}`}
                      onclick={() => removeFile(i)}>×</button>
            </span>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}

  {#if error}
    <div
      class="rounded-xl px-3 py-2 text-xs error-bubble"
      in:fly={{ y: -4, duration: 220, easing: cubicOut }}
    >
      {error}
    </div>
  {/if}

  {#if _isChunkedUploading}
    <!-- Inline hint: block send while large file uploads are in flight -->
    <div class="text-xs text-muted px-1" in:fly={{ y: -4, duration: 180, easing: cubicOut }}>
      Waiting for upload to finish before sending…
    </div>
  {/if}

  {#if showRecorder}
    <div in:fly={{ y: 4, duration: 180, easing: cubicOut }}>
      <VoiceRecorder
        bind:this={recorderRef}
        bar={isMobile}
        onrecorded={async ({ blob, mimeType, durationMs, send }) => {
          // Derive a safe filename from the mime type.
          const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
          const file = new File([blob], `voice-msg.${ext}`, { type: mimeType });
          addFiles([file]);
          showRecorder = false;
          void durationMs; // used by the blob builder; no further action needed here.
          // The phone bar's round button means "send now".
          if (send) {
            await tick();
            onSend();
          }
        }}
        oncancel={() => { showRecorder = false; }}
      />
    </div>
  {/if}

  <div class="flex items-end gap-2 {showRecorder && isMobile ? 'hidden' : ''}" data-testid="composer-row">
    <!-- Desktop / tablet controls -->
    <label class="btn btn-ghost shrink-0 cursor-pointer max-sm:hidden"
           aria-label="Attach file">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
      <input type="file" multiple class="hidden" onchange={onFileInput} />
    </label>

    {#if canRecord()}
      <!-- Voice-message mic: toggles the recorder panel. -->
      <button
        type="button"
        class="btn btn-icon shrink-0 max-sm:hidden"
        style={showRecorder ? "background: var(--accent-wash-strong); border-color: var(--accent-line);" : ""}
        aria-label={showRecorder ? 'Hide voice recorder' : 'Record voice message'}
        aria-pressed={showRecorder}
        disabled={sending}
        onclick={() => { showRecorder = !showRecorder; }}
        title="Record voice message"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>

      <!-- Dictation (speech bubble glyph): appends transcribed text to the textarea. -->
      <span class="max-sm:hidden">
        <MicToText
          {sending}
          voiceRecorderActive={showRecorder}
          ontext={(text) => { body = body ? `${body}${text}` : text.trimStart(); }}
        />
      </span>
    {/if}

    <!-- Phones: one rounded field holding dictation, text, attach and camera.
         From sm up the wrapper disappears (display: contents) and the
         textarea sits between the desktop controls as before. -->
    <div class="composer-pill flex flex-1 min-w-0 items-end sm:contents">
      {#if canRecord()}
        <span class="sm:hidden shrink-0">
          <MicToText
            bare
            {sending}
            voiceRecorderActive={showRecorder}
            ontext={(text) => { body = body ? `${body}${text}` : text.trimStart(); }}
          />
        </span>
      {/if}

      <textarea
        class="textarea flex-1 min-w-0"
        rows="1"
        placeholder={dragging
          ? 'Drop files…'
          : asInternal
            ? isMobile ? 'Internal note…' : 'Internal note (only admins will see this)…'
            : isMobile ? 'Message' : 'Write a reply…'}
        bind:value={body}
        bind:this={textareaRef}
        oninput={onTyping}
        onkeydown={onKeydown}
        enterkeyhint="enter"
        style="min-height: 38px; max-height: min(40dvh, 360px); resize: none; overflow-y: auto;"
      ></textarea>

      <div class="sm:hidden shrink-0 flex items-center">
        <label class="btn btn-ghost cursor-pointer btn-lg btn-icon btn-round" aria-label="Attach file" data-testid="composer-attach">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          <input type="file" multiple class="hidden" onchange={onFileInput} />
        </label>
        <!-- Camera: opens the device camera directly on phones. Hidden while
             typing, like a chat app, to leave room for the text. -->
        {#if !body.trim()}
          <label class="btn btn-ghost cursor-pointer btn-lg btn-icon btn-round" aria-label="Take a photo" data-testid="composer-camera">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <input type="file" accept="image/*" capture="environment" class="hidden" onchange={onFileInput} />
          </label>
        {/if}
      </div>
    </div>

    <!-- Desktop / tablet send -->
    <button
      type="submit"
      class="btn btn-primary shrink-0 max-sm:hidden"
      disabled={sending || _isChunkedUploading}
      title={_isChunkedUploading ? 'Wait for uploads to finish' : 'Send (Ctrl or Cmd + Enter)'}
    >
      {#if sending}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" class="animate-spin" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      {:else}
        Send
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      {/if}
    </button>

    <!-- Phones: a single round button. Mic when there is nothing to send,
         send arrow otherwise (same behaviour as the big chat apps). -->
    {#if hasContent || !canRecord()}
      <button
        type="submit"
        class="btn btn-primary shrink-0 sm:hidden btn-xl btn-icon btn-round"
        disabled={sending || _isChunkedUploading || !hasContent}
        aria-label="Send"
        data-testid="composer-send"
        title={_isChunkedUploading ? 'Wait for uploads to finish' : undefined}
      >
        {#if sending}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" class="animate-spin" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        {:else}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        {/if}
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-primary shrink-0 sm:hidden btn-xl btn-icon btn-round"
        disabled={sending}
        aria-label="Record voice message"
        data-testid="composer-mic"
        onclick={startVoiceOnPhone}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
    {/if}
  </div>
</form>

<style>
  /* Phone composer: the field is a rounded pill that owns the border and the
     focus ring, and the textarea inside it is borderless. */
  @media (max-width: 639.98px) {
    .composer-pill {
      min-height: 44px;
      padding: 0 4px;
      border-radius: 24px;
      border: 1px solid var(--glass-border);
      background: oklch(0 0 0 / 0.2);
      transition: border-color 180ms, box-shadow 180ms;
    }
    :global(:root[data-theme='light']) .composer-pill {
      background: oklch(1 0 0 / 0.7);
    }
    .composer-pill:focus-within {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px var(--accent-wash-strong);
    }
    /* Icon buttons inside the pill are flat: no glass highlight ring. */
    .composer-pill :global(.btn) {
      box-shadow: none;
    }
    .composer-pill textarea {
      border: 0;
      background: transparent;
      box-shadow: none;
      border-radius: 0;
      padding: 10px 6px;
      line-height: 1.35;
      /* About six lines, like a chat app, then it scrolls. */
      max-height: min(28dvh, 144px) !important;
    }
    .composer-pill textarea:focus {
      border: 0;
      box-shadow: none;
    }
  }
</style>
