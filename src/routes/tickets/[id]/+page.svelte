<script lang="ts">
  import { afterNavigate, invalidateAll, pushState } from '$app/navigation';
  import { onMount, onDestroy, tick } from 'svelte';
  import { fly, scale, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { flip } from 'svelte/animate';
  import { enhance } from '$app/forms';
  import { linkify, fmtBytes, shortTime, niceDate } from '$lib/format';
  import {
    enableNotifications,
    ensurePushSubscription,
    maybeNotify,
    notifyState,
    type NotifyState
  } from '$lib/notifications';
  import Avatar from '$lib/Avatar.svelte';
  import TypingIndicator from '$lib/TypingIndicator.svelte';
  import Composer from '$lib/Composer.svelte';
  import TicketSidebar from '$lib/TicketSidebar.svelte';
  import ImageLightbox from '$lib/ImageLightbox.svelte';
  import { loadTicketNav, positionIn } from '$lib/ticketNav';
  import { needsRendition } from '$lib/audioFormats';
  import ExtendTimeModal from '$lib/ExtendTimeModal.svelte';
  import { formatRemaining, slaTone } from '$lib/sla';

  // Mirrors `DBAttachment` from `src/lib/server/db.ts` — the server
  // streams DB rows through to the page as-is, so we read the snake_case
  // column names directly here. Mis-aliasing this as `{ mime, size }`
  // previously caused `isImage(a.mime)` to evaluate against undefined
  // and silently fall back to the file-icon branch for every attachment,
  // including images.
  type TranscriptStatus = 'pending' | 'ready' | 'failed';
  type Attachment = {
    id: number;
    filename: string;
    mime_type: string;
    size_bytes: number;
    stored_name?: string;
    silent?: number | null;
    cid?: string;
    transcript_status: TranscriptStatus | null;
    transcript_text: string | null;
    transcript_lang: string | null;
  };
  type Reaction = { emoji: string; count: number; mine: boolean };
  type RepliedToPreview = { id: number; body: string; sender_email: string };
  type MessageView = {
    id: number;
    sender_id: number;
    sender_email: string;
    sender_role: 'admin' | 'user';
    body: string;
    created_at: number;
    edited_at: number | null;
    deleted_at: number | null;
    internal: 0 | 1;
    via_token_id: number | null;
    attachments: Attachment[];
    reactions: Reaction[];
    replied_to: RepliedToPreview | null;
    unread?: boolean;
  };
  type Ticket = {
    id: number;
    title: string;
    status: 'open' | 'pending' | 'closed';
    priority: 'urgent' | 'high' | 'normal' | 'low';
    priority_reason: string | null;
    sla_due_at: number | null;
    user_id: number;
    user_email: string;
    assigned_to: number | null;
    group_id: number | null;
    archived_at: number | null;
    created_at: number;
    updated_at: number;
  };
  type Project = { id: number; name: string; slug: string };
  type AdminLite = { id: number; email: string };
  type GroupLite = { id: number; name: string; project_name: string } | null;
  type Participant = { email: string; user_id: number | null; role: 'owner' | 'member' | 'admin' | 'cc' };
  type ReadReceipt = { user_id: number; email: string; last_read_at: number };
  type Task = {
    id: number;
    ticket_id: number;
    assignee_user_id: number;
    created_by_user_id: number;
    title: string;
    description: string;
    completed_at: number | null;
    completed_by_user_id: number | null;
    created_at: number;
    assignee_email: string;
    created_by_email: string;
    completed_by_email: string | null;
  };

  // Back target: the list the user came from (inbox with its filters, Queue
  // or Gantt); /tickets when the ticket was opened directly or from another ticket.
  let backHref = $state('/tickets');
  let backLabel = $state('Back to inbox');
  afterNavigate(({ from }) => {
    const p = from?.url.pathname;
    if (p === '/tickets' || p === '/queue' || p === '/gantt') {
      backHref = p + (from?.url.search ?? '');
      backLabel = p === '/queue' ? 'Back to queue' : p === '/gantt' ? 'Back to Gantt' : 'Back to inbox';
    }
  });

  type Props = {
    data: {
      ticket: Ticket;
      messages: MessageView[];
      projects: Project[];
      allProjects: Project[];
      group: GroupLite;
      admins: AdminLite[];
      followers: string[];
      participants: Participant[];
      participantReads: ReadReceipt[];
      tasks: Task[];
      extensions: Array<{ id: number; hours: number; reason: string; created_at: number; user_email: string | null }>;
      isAdmin: boolean;
      currentUserId: number;
    };
  };

  const { data }: Props = $props();

  // Previous / next ticket within the list the user came from (inbox with its
  // filters, Queue or Gantt). Hidden when the ticket was opened directly.
  const SOURCE_LABEL = { inbox: 'Back to inbox', queue: 'Back to queue', gantt: 'Back to Gantt' } as const;
  let listNav = $state(loadTicketNav());
  const pos = $derived(positionIn(listNav, data.ticket.id));
  $effect(() => {
    void data.ticket.id;
    listNav = loadTicketNav();
  });
  $effect(() => {
    // The stored list also tells where "back" leads, even after prev/next.
    if (listNav && pos) {
      backHref = listNav.href;
      backLabel = SOURCE_LABEL[listNav.source];
    }
  });

  // ── Extend the response time (reason required, like marking a ticket urgent) ──
  let extendOpen = $state(false);
  let extendBusy = $state(false);
  let extendError = $state<string | null>(null);
  let extendForm = $state<HTMLFormElement | null>(null);
  let extendHours = $state('24');
  let extendReason = $state('');
  let slaNow = $state(Math.floor(Date.now() / 1000));
  onMount(() => {
    const t = setInterval(() => (slaNow = Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  });
  const canExtend = $derived(data.ticket.status !== 'closed' && data.ticket.sla_due_at != null);
  const slaText = $derived(formatRemaining(data.ticket.sla_due_at, slaNow));
  const slaToneNow = $derived(slaTone(data.ticket.sla_due_at, data.ticket.priority, slaNow));
  function openExtend() {
    extendError = null;
    extendOpen = true;
  }
  function confirmExtend(hours: number, reason: string) {
    extendHours = String(hours);
    extendReason = reason;
    extendError = null;
    // Let the hidden inputs pick up the values before the form serialises.
    queueMicrotask(() => extendForm?.requestSubmit());
  }

  /**
   * ID of the viewer's last own (non-deleted) message in the timeline.
   * Read receipts only render under this one message so the chat
   * doesn't get cluttered with "Read by …" lines under every old
   * bubble. `isMine()` resolves to "any admin's message" for admin
   * viewers and "my own user_id" otherwise — same rule as bubble
   * alignment.
   */
  const myLastMessageId = $derived.by(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m.deleted_at && isMine(m)) return m.id;
    }
    return null;
  });

  /**
   * Receipts that should appear under a given message. A receipt is
   * shown when (a) the participant is not the message's author, and
   * (b) their `last_read_at` is later than the message's `created_at`.
   * The data flows through `data.participantReads` and re-evaluates on
   * every invalidateAll triggered by an SSE 'read' event.
   */
  function receiptsFor(m: MessageView): ReadReceipt[] {
    return data.participantReads.filter(
      (r) => r.user_id !== m.sender_id && r.last_read_at > m.created_at
    );
  }

  function readerLabel(email: string): string {
    // First chunk before '@' is enough — keeps the eyebrow short.
    const at = email.indexOf('@');
    return at > 0 ? email.slice(0, at) : email;
  }

  // ---- local state ------------------------------------------------------

  // Track attachment IDs that are currently mid-POST to /transcribe so the
  // UI can show a spinner before the SSE 'transcription' event arrives.
  let transcribingIds = $state<Set<number>>(new Set());

  let messages = $state<MessageView[]>([]);
  let body = $state('');
  let asInternal = $state(false);
  let sending = $state(false);
  let error = $state<string | null>(null);
  let pendingFiles = $state<File[]>([]);
  // Chunked upload state (managed by Composer, exposed via bindings).
  let isChunkedUploading = $state(false);
  let chunkedUploadSessionIds = $state<string[]>([]);
  let live = $state(false);
  let typingFrom = $state<{ email: string; userId?: number; at: number } | null>(null);
  let typingClearTimer: ReturnType<typeof setTimeout> | null = null;
  let editingId = $state<number | null>(null);
  let editingBody = $state('');
  let showReactionsFor = $state<number | null>(null);
  let editingProjects = $state(false);
  let projectDraft = $state<number[]>([]);
  let followerDraft = $state('');
  let notifState = $state<NotifyState>('default');
  let scrollEl: HTMLElement | null = $state(null);
  /** The message the user is currently replying to (null = not in reply mode). */
  let replyingTo = $state<RepliedToPreview | null>(null);
  /** Ref to the composer's textarea so we can focus it when entering reply mode. */
  let composerTextareaRef: HTMLTextAreaElement | null = $state(null);
  /** Ref to the composer wrapper so we can scroll it into view. */
  let composerRef: HTMLElement | null = $state(null);
  // "stickyBottom" = the user is at (or within a small margin of) the bottom
  // of the conversation. We only auto-scroll on new activity when they're
  // sticky; otherwise they're reading history and we don't yank them down.
  let stickyBottom = $state(true);
  const STICKY_THRESHOLD_PX = 80;

  function onMessagesScroll() {
    if (!scrollEl) return;
    const distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    stickyBottom = distance < STICKY_THRESHOLD_PX;
  }

  const REACTIONS = ['👍', '❤️', '😄', '🎉', '🙏', '👀', '✅', '🚀'];

  // sync from props on navigation
  $effect.pre(() => {
    messages = data.messages;
    if (!editingProjects) {
      projectDraft = data.projects.map((p) => p.id);
    }
  });

  // who is "me" for bubble alignment
  function isMine(m: MessageView): boolean {
    if (data.isAdmin) return m.sender_role === 'admin';
    return m.sender_id === data.currentUserId;
  }

  // ---- SSE --------------------------------------------------------------

  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 500;

  function connectSSE() {
    es?.close();
    es = new EventSource(`/api/messages/${data.ticket.id}/stream`);
    es.addEventListener('hello', () => {
      live = true;
      backoff = 500;
    });
    // Server broadcasts only { id: messageId } — fall back to invalidate().
    es.addEventListener('message', () => {
      // The message implicitly means whoever was typing just sent it (or
      // someone else replied) — either way, the indicator is now stale.
      if (typingClearTimer) {
        clearTimeout(typingClearTimer);
        typingClearTimer = null;
      }
      typingFrom = null;
      invalidateAll().then(async () => {
        const last = messages[messages.length - 1];
        const focused =
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible' &&
          document.hasFocus();
        if (last && !focused) {
          // OS-level Notification, only when the tab is in the background.
          maybeNotify({
            title: `${last.sender_email} · ${data.ticket.title}`,
            body: last.body.slice(0, 140),
            tag: `hilo-${data.ticket.id}`,
            onClickUrl: `/tickets/${data.ticket.id}`
          });
        }
        scrollToBottom();
        // Fix the brief badge-flash on the active conversation: when the
        // user is looking at THIS ticket as the new message arrives, mark
        // it read immediately so the unread total doesn't briefly bump
        // and then clear via the 1.8s scheduleMarkRead timer.
        if (focused) {
          try {
            await fetch(`/api/tickets/${data.ticket.id}/read`, { method: 'POST' });
            await invalidateAll();
          } catch {
            // best-effort
          }
        }
      });
    });
    es.addEventListener('typing', (e: MessageEvent) => {
      try {
        const t = JSON.parse(e.data) as { email: string; userId?: number };
        // Ignore our own typing pings echoed back from the broadcast.
        if (t.userId != null && t.userId === data.currentUserId) return;
        typingFrom = { email: t.email, userId: t.userId, at: Date.now() };
        // Auto-clear after the throttle window so the indicator doesn't
        // linger if the other side stops typing without sending.
        if (typingClearTimer) clearTimeout(typingClearTimer);
        typingClearTimer = setTimeout(() => {
          typingFrom = null;
          typingClearTimer = null;
        }, 2500);
        // Reveal the indicator if the conversation is scrolled.
        scrollToBottom();
      } catch {}
    });
    es.addEventListener('reaction', () => { invalidateAll(); });
    // Server sends only { message_id } for these; just resync via load.
    es.addEventListener('edit', () => { invalidateAll(); });
    es.addEventListener('delete', () => { invalidateAll(); });
    // A participant moved their read pointer — refresh so the author
    // sees the "Read by …" receipt appear under their last bubble.
    es.addEventListener('read', () => { invalidateAll(); });
    // Someone created, toggled or deleted a task on this ticket —
    // refresh so the sidebar Tasks panel mirrors the change.
    es.addEventListener('task', () => { invalidateAll(); });
    // A transcript finished (or failed) — reload so audio attachments
    // show the updated transcript text / status.
    es.addEventListener('transcription', () => { invalidateAll(); });
    es.addEventListener('attachment', () => { invalidateAll(); });
    es.onerror = () => {
      live = false;
      es?.close();
      es = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectSSE, backoff);
      backoff = Math.min(30_000, backoff * 2);
    };
  }

  // ---- typing ping (throttled) -----------------------------------------

  let lastTypingPing = 0;
  function pingTyping() {
    const now = Date.now();
    if (now - lastTypingPing < 1000) return;
    lastTypingPing = now;
    fetch(`/api/messages/${data.ticket.id}/typing`, { method: 'POST' }).catch(() => {});
  }

  // ---- send -------------------------------------------------------------

  async function send() {
    const text = body.trim();
    if (!text && pendingFiles.length === 0 && chunkedUploadSessionIds.length === 0) return;
    // Guard: block send while large file uploads are in flight.
    if (isChunkedUploading) return;
    sending = true;
    error = null;
    try {
      const fd = new FormData();
      fd.set('body', text);
      if (data.isAdmin && asInternal) fd.set('internal', '1');
      if (replyingTo) fd.set('repliedToMessageId', String(replyingTo.id));
      // Single-shot files (≤ 95 MB): send bytes directly.
      // Large files (> 95 MB) have already been uploaded via the chunked path
      // and are referenced by session id in chunkedUploadSessionIds below.
      const { shouldUseChunked } = await import('$lib/uploads');
      for (const f of pendingFiles) {
        if (!shouldUseChunked(f)) fd.append('files', f);
      }
      // Chunked files: reference by upload session id (file already on server).
      for (const id of chunkedUploadSessionIds) fd.append('upload_session_ids', id);

      const res = await fetch(`/api/messages/${data.ticket.id}`, { method: 'POST', body: fd });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 415) {
          throw new Error(
            `Hilo could not accept one of the files. Some types are blocked for security ` +
            `(e.g. SVG). Server says: ${text || 'unsupported file type'}.`
          );
        }
        if (res.status === 413) {
          throw new Error('That file is larger than the server allows. Try a smaller one.');
        }
        if (res.status === 409 && text.includes('ticket_closed')) {
          // The ticket was closed while this page was open: show the closed state.
          await invalidateAll();
          throw new Error(
            'This ticket was closed, so your message was not sent. Open a new ticket if you need something else.'
          );
        }
        throw new Error(text || `Send failed with status ${res.status}`);
      }
      body = '';
      pendingFiles = [];
      chunkedUploadSessionIds = [];
      asInternal = false;
      replyingTo = null;
      await invalidateAll();
      // Always follow your own send — even if you were reading history.
      scrollToBottom({ force: true });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not send';
    } finally {
      sending = false;
    }
  }

  function applyTemplate(text: string) {
    body = body ? `${body}\n\n${text}` : text;
  }

  // ---- reactions --------------------------------------------------------

  async function react(messageId: number, emoji: string) {
    showReactionsFor = null;
    await fetch(`/api/messages/${messageId}/react`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emoji })
    });
  }

  // ---- edit / delete ----------------------------------------------------

  function startEdit(m: MessageView) {
    editingId = m.id;
    editingBody = m.body;
  }
  async function saveEdit() {
    if (editingId == null) return;
    await fetch(`/api/messages/${editingId}/edit`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: editingBody })
    });
    editingId = null;
    await invalidateAll();
  }
  function cancelEdit() {
    editingId = null;
    editingBody = '';
  }
  async function deleteMessage(id: number) {
    if (!confirm('Delete this message?')) return;
    await fetch(`/api/messages/${id}/edit`, { method: 'DELETE' });
    await invalidateAll();
  }

  // ---- sidebar mutations ------------------------------------------------

  async function assignTo(adminUserId: number | null) {
    const res = await fetch(`/api/tickets/${data.ticket.id}/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminUserId })
    });
    if (!res.ok) {
      // Surface the refusal instead of silently reverting on the next reload.
      const payload = await res.json().catch(() => ({}));
      error = (payload as { error?: string }).error ?? 'Could not assign the ticket.';
    }
    await invalidateAll();
  }

  async function toggleArchive() {
    await fetch(`/api/tickets/${data.ticket.id}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: !data.ticket.archived_at })
    });
    await invalidateAll();
  }

  function toggleProject(id: number) {
    projectDraft = projectDraft.includes(id)
      ? projectDraft.filter((x) => x !== id)
      : [...projectDraft, id];
  }
  async function saveProjects() {
    await fetch(`/api/tickets/${data.ticket.id}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectIds: projectDraft })
    });
    editingProjects = false;
    await invalidateAll();
  }

  async function addFollower() {
    const v = followerDraft.trim();
    if (!v) return;
    await fetch(`/api/tickets/${data.ticket.id}/followers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: v })
    });
    followerDraft = '';
    await invalidateAll();
  }
  async function removeFollower(email: string) {
    await fetch(`/api/tickets/${data.ticket.id}/followers`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email })
    });
    await invalidateAll();
  }

  async function enableBrowserNotifs() {
    await enableNotifications();
    await ensurePushSubscription();
    notifState = notifyState();
  }

  // ---- reply mode -------------------------------------------------------

  /**
   * Scroll the message list to the message with the given id and briefly
   * flash it so the user can locate the context of a quoted reply.
   */
  function scrollToMessage(id: number) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-flash');
    setTimeout(() => el.classList.remove('msg-flash'), 1200);
  }

  function startReply(m: MessageView) {
    replyingTo = { id: m.id, body: m.body, sender_email: m.sender_email };
    // Give the DOM a tick to render the reply pill, then focus + scroll.
    tick().then(() => {
      composerRef?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      composerTextareaRef?.focus();
    });
  }

  function cancelReply() {
    replyingTo = null;
  }

  // ---- transcription -------------------------------------------------------

  async function requestTranscript(attachmentId: number) {
    transcribingIds = new Set([...transcribingIds, attachmentId]);
    try {
      const res = await fetch(`/api/attachments/${attachmentId}/transcribe`, { method: 'POST' });
      if (!res.ok) {
        const msg = await res.text().catch(() => 'Transcription request failed');
        error = msg.slice(0, 200);
      }
      // Success: SSE 'transcription' event will call invalidateAll().
    } catch {
      error = 'Could not reach the transcription service.';
    } finally {
      transcribingIds = new Set([...transcribingIds].filter((x) => x !== attachmentId));
    }
  }

  // ---- misc -------------------------------------------------------------

  function isImage(mime: string) { return mime.startsWith('image/'); }
  function isAudio(mime: string) { return mime.startsWith('audio/'); }
  function isVideo(mime: string) { return mime.startsWith('video/'); }


  /**
   * Force=true bypasses the sticky check — used when the local user is the
   * author of the new message (you always want to see what you just sent)
   * or for the initial mount.
   *
   * Three-phase wait so we land on the *final* scrollHeight:
   *   1) await tick() — flush Svelte's pending DOM mutations from
   *      invalidateAll's data update.
   *   2) double rAF — give the browser a frame to commit layout.
   *   3) follow-up at 340ms — catches the case where the in:fly
   *      transition (260ms) shifts what counts as the bottom; the
   *      follow-up is also gated on stickyBottom so it doesn't fight
   *      a user who has since scrolled away.
   */
  async function scrollToBottom(opts: { force?: boolean } = {}) {
    if (!scrollEl) return;
    const force = !!opts.force;
    if (!force && !stickyBottom) return;
    await tick();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    setTimeout(() => {
      if (!scrollEl) return;
      if (!force && !stickyBottom) return;
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }, 340);
  }

  // Sprint D: after a short focus delay, tell the server we've read up
  // to the latest message. The delay (1.8s) gives the eye time to find
  // the "NEW" markers before they disappear. Re-fires whenever new
  // messages stream in via SSE while the page stays open.
  let readTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleMarkRead() {
    if (readTimer) clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      try {
        await fetch(`/api/tickets/${data.ticket.id}/read`, { method: 'POST' });
        // refresh the layout's unreadTotal + the inbox row count
        await invalidateAll();
      } catch {
        // swallow — read is opportunistic
      }
    }, 1800);
  }

  onMount(() => {
    connectSSE();
    notifState = notifyState();
    // First paint: jump to the latest message regardless of where the
    // scroll container thinks it is (it hasn't been measured yet).
    scrollToBottom({ force: true });
    scheduleMarkRead();

    // Esc cancels reply mode (if active) before any other global handler.
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && replyingTo) {
        e.stopPropagation();
        replyingTo = null;
      }
    }
    document.addEventListener('keydown', onKeydown, { capture: true });
    return () => document.removeEventListener('keydown', onKeydown, { capture: true });
  });

  // iOS keyboard lock-down.
  //
  // Default iOS Safari behavior when an input receives focus: the
  // browser scrolls the *body* up so the input lands near the top of
  // the visible area above the keyboard. On a fit-to-viewport layout
  // like this one, that pushes the navbar and the chat messages off
  // the top of the screen, leaves the composer floating against the
  // status bar (broken safe-area), and creates a big empty gap
  // between the composer and the top of the keyboard. The
  // `interactive-widget=resizes-content` viewport meta and `100dvh`
  // are not enough — iOS still does the scroll-into-view.
  //
  // The cure is to make the body un-scrollable while this page is
  // mounted. `position: fixed` on the body removes it from the normal
  // scroll flow, so iOS has nothing to scroll. The chat-shell uses
  // `--vv-h` (visualViewport.height) for its sizing, so when the
  // keyboard opens the chat shrinks correctly and the composer stays
  // glued to the keyboard edge, exactly where it should be.
  //
  // `window.scrollTo(0, 0)` on every visualViewport change is a
  // belt-and-suspenders correction for the case where iOS scrolled
  // the body in the brief window before we locked it.
  onMount(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyWidth: body.style.width,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = '0';
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    window.scrollTo(0, 0);

    function snapToTop() {
      // Defer one frame so iOS commits its own scroll first, then we override.
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
    window.visualViewport?.addEventListener('resize', snapToTop);
    window.visualViewport?.addEventListener('scroll', snapToTop);

    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      body.style.width = prev.bodyWidth;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.right = prev.bodyRight;
      window.visualViewport?.removeEventListener('resize', snapToTop);
      window.visualViewport?.removeEventListener('scroll', snapToTop);
    };
  });

  // NOTE: a $effect that called scheduleMarkRead on every messages
  // reference change lived here previously. It caused a runaway loop —
  // each POST /api/tickets/[id]/read triggered an invalidateAll which
  // returned a fresh messages array (new reference even when content
  // matched), the effect re-fired, scheduled another 1.8s timer, and
  // so on. The eager mark-read inside the SSE 'message' handler above
  // already covers the "new content arrived while you're looking"
  // case, so we no longer need a reactive watcher here.

  onDestroy(() => {
    es?.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (typingClearTimer) clearTimeout(typingClearTimer);
    if (readTimer) clearTimeout(readTimer);
  });

  const owner = $derived(data.participants.find((p) => p.role === 'owner'));

  // Mobile info drawer (sidebar accessible below lg breakpoint)
  let infoOpen = $state(false);

  // Image viewer. Visibility lives in local state, NOT in `$page.state`:
  // `invalidateAll()` (mark-as-read timer, SSE refreshes, manual refresh)
  // resets SvelteKit's page state by default, which used to close the modal
  // about 1.8 s after the ticket opened. A shallow history entry is still
  // pushed so the device Back button closes the viewer instead of leaving the
  // ticket; `popstate` is the only thing that closes it from history.
  let lightbox = $state<{ src: string; alt: string } | null>(null);
  let lightboxEntry = false;
  function openLightbox(src: string, alt: string) {
    lightbox = { src, alt };
    pushState('', { lightbox: true });
    lightboxEntry = true;
  }
  function closeLightbox() {
    lightbox = null;
    if (lightboxEntry) {
      lightboxEntry = false;
      history.back();
    }
  }
  function onPopState() {
    lightboxEntry = false;
    lightbox = null;
  }
</script>

<svelte:head>
  <!-- The default <main> has min-h:100dvh, intended for short list pages
       so the gradient backdrop stays full-bleed. For ticket detail we
       want the body to be EXACTLY one viewport tall (navbar + chat),
       otherwise iOS scrolls the page when the keyboard opens and the
       composer ends up floating above a gap of empty space. Drop the
       min-height here so chat-shell can own the viewport. -->
  <style>main { min-height: 0 !important; }</style>
</svelte:head>

<section class="ticket-shell max-w-6xl mx-auto px-0 sm:px-6 py-0 sm:py-5">
  <div class="grid gap-0 sm:gap-5 lg:grid-cols-[1fr_280px]">
    <!-- ============== Chat column ============== -->
    <div
      class="glass chat-shell flex flex-col overflow-hidden"
      in:scale={{ start: 0.99, duration: 320, easing: cubicOut, opacity: 0 }}
    >
      <!-- A) Header -->
      <header class="px-4 sm:px-5 py-3 sm:py-4 flex flex-wrap sm:flex-nowrap items-start gap-3 max-sm:gap-y-2"
              style="border-bottom: 1px solid var(--glass-border);">
        <!-- Shown at every width; the navbar hides its own chevron on ticket pages. -->
        <a
          href={backHref}
          class="btn btn-ghost inline-flex shrink-0 -ml-2 max-sm:order-1 btn-lg btn-icon"
          aria-label={backLabel}
          title={backLabel}
          data-testid="ticket-back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </a>
        <!-- On phones this wrapper disappears (display: contents) so the chips row,
             the title and the owner line become rows of the header itself. -->
        <div class="flex-1 min-w-0 max-sm:contents">
          <div class="flex flex-wrap items-center gap-2 mb-2 max-sm:order-2 max-sm:flex-1 max-sm:min-w-0 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:mb-0 max-sm:[&>*]:shrink-0 max-sm:whitespace-nowrap"
               style="scrollbar-width: none;">
            <span class="num text-fainter text-[11px]">#{data.ticket.id}</span>
            <span class="chip chip-{data.ticket.status}">
              <span class="inline-block w-1.5 h-1.5 rounded-full" style="background: currentColor;"></span>
              {data.ticket.status}
            </span>
            {#if data.ticket.priority !== 'normal'}
              <span class="chip chip-{data.ticket.priority}">{data.ticket.priority}</span>
            {/if}
            {#if canExtend}
              <!-- The countdown doubles as the shortcut to ask for more time (phones and desktop). -->
              <button type="button" class="chip sla-{slaToneNow} cursor-pointer max-sm:min-h-9 max-sm:px-3" onclick={openExtend}
                      title="Extend time" aria-label={`Response time: ${slaText}. Extend time`}
                      data-testid="sla-chip">
                {slaText}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            {/if}
            {#each data.projects as p}
              <span class="chip chip-project max-w-[70vw] sm:max-w-xs truncate" title={p.name}>{p.name}</span>
            {/each}
            {#if live}
              <span class="chip chip-live" style="border-radius: 999px;">
                <span class="inline-block w-1.5 h-1.5 rounded-full" style="background: currentColor;"></span>
                live
              </span>
            {/if}
          </div>

          <h1 class="text-lg font-bold tracking-tight truncate max-sm:order-5 max-sm:basis-full max-sm:whitespace-normal max-sm:line-clamp-2 max-sm:leading-snug">{data.ticket.title}</h1>

          {#if data.isAdmin && owner}
            <div class="text-fainter text-xs mt-0.5 max-sm:order-6 max-sm:basis-full max-sm:mt-0">from {owner.email}</div>
          {/if}
        </div>

        <!-- Previous / next ticket in the list the user came from -->
        {#if pos && pos.total > 1}
          <!-- Phones: its own full-width row under the title so the title keeps its width. -->
          <div class="flex items-center shrink-0 -mx-1 max-sm:order-last max-sm:basis-full max-sm:mx-0 max-sm:justify-between max-sm:border-t max-sm:pt-2"
               style="border-color: var(--glass-border);" data-testid="ticket-pager">
            {#if pos.prev !== null}
              <a
                href={`/tickets/${pos.prev}`}
                data-sveltekit-replacestate
                data-sveltekit-noscroll
                class="btn btn-ghost w-9 max-sm:w-auto max-sm:px-3 max-sm:gap-1.5"
                style="height:40px; padding:0;"
                aria-label="Previous ticket"
                title="Previous ticket (k)"
                data-testid="ticket-prev"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
                <span class="sm:hidden text-sm">Previous</span>
              </a>
            {:else}
              <span class="btn btn-ghost w-9 max-sm:w-auto max-sm:px-3 max-sm:gap-1.5" aria-disabled="true" data-testid="ticket-prev-disabled"
                    style="height:40px; padding:0; opacity:.3; pointer-events:none;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
                <span class="sm:hidden text-sm">Previous</span>
              </span>
            {/if}
            <span class="text-[11px] max-sm:text-xs text-fainter num px-0.5"
                  data-testid="ticket-position" aria-live="polite">{pos.index} / {pos.total}</span>
            {#if pos.next !== null}
              <a
                href={`/tickets/${pos.next}`}
                data-sveltekit-replacestate
                data-sveltekit-noscroll
                class="btn btn-ghost w-9 max-sm:w-auto max-sm:px-3 max-sm:gap-1.5"
                style="height:40px; padding:0;"
                aria-label="Next ticket"
                title="Next ticket (j)"
                data-testid="ticket-next"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span class="sm:hidden text-sm">Next</span>
              </a>
            {:else}
              <span class="btn btn-ghost w-9 max-sm:w-auto max-sm:px-3 max-sm:gap-1.5" aria-disabled="true" data-testid="ticket-next-disabled"
                    style="height:40px; padding:0; opacity:.3; pointer-events:none;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span class="sm:hidden text-sm">Next</span>
              </span>
            {/if}
          </div>
        {/if}

        <!-- Info button: only visible below lg (sidebar becomes a drawer) -->
        <button
          type="button"
          class="lg:hidden btn btn-ghost shrink-0 max-sm:order-3 btn-lg btn-icon"
          aria-label="Show ticket info"
          aria-expanded={infoOpen}
          onclick={() => (infoOpen = true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>

        <!-- Only an administrator reopens a closed ticket. -->
        {#if data.ticket.status !== 'closed' || data.isAdmin}
          <form method="POST" use:enhance class="max-sm:order-4"
                action={data.ticket.status === 'closed' ? '?/reopen' : '?/close'}>
            <button type="submit" class="btn btn-ghost shrink-0" data-testid="close-reopen">
              {data.ticket.status === 'closed' ? 'Reopen' : 'Close'}
            </button>
          </form>
        {/if}
      </header>

      <!-- B) Messages list -->
      <ul
        bind:this={scrollEl}
        onscroll={onMessagesScroll}
        class="flex-1 overflow-y-auto thin-scroll p-5 space-y-4"
      >
        {#if messages.length === 0}
          <li class="text-center text-fainter text-sm py-12">
            Quiet here. Send the first message ↓
          </li>
        {/if}

        {#each messages as m, i (m.id)}
          <li
              id="msg-{m.id}"
              class="group flex flex-col gap-1 {isMine(m) ? 'items-end' : 'items-start'}"
              class:is-unread={m.unread}
              in:fly={{ y: 8, duration: 260, easing: cubicOut }}
          >
            {#if m.unread && (i === 0 || !messages[i - 1]?.unread)}
              <div
                class="relative flex items-center gap-3 w-full py-1 mb-1 text-[10.5px] font-bold tracking-[0.18em] uppercase"
                style="color: var(--color-accent);"
                aria-label="Unread messages below"
              >
                <span class="h-px flex-1" style="background: var(--color-accent); opacity:0.55;"></span>
                <span>New</span>
                <span class="h-px flex-1" style="background: var(--color-accent); opacity:0.55;"></span>
              </div>
            {/if}
            <div class="flex items-center gap-2 text-[11px]">
              <Avatar email={m.sender_email} size={20} />
              <span class={m.sender_role === 'admin' ? 'text-accent font-semibold' : 'sender-user font-semibold'}>
                {m.sender_role === 'admin' ? 'Admin' : m.sender_email}
              </span>
              {#if m.via_token_id}
                <span class="chip" title="Written by an agent using an API token" data-testid="agent-chip">agent</span>
              {/if}
              <span class="text-fainter num">{shortTime(m.created_at)}</span>
              {#if m.edited_at}
                <span class="text-[10px] text-fainter">edited</span>
              {/if}
              {#if m.unread}
                <span
                  class="ml-1 inline-flex items-center justify-center rounded-full px-1.5 text-[9px] font-bold tracking-widest uppercase"
                  style="background: var(--color-accent); color: oklch(0.15 0.04 270); height: 14px;"
                >NEW</span>
              {/if}
            </div>

            <div class="relative" style="max-width: 78%;">
              {#if m.deleted_at}
                <div class="bubble-deleted">message deleted</div>
              {:else if editingId === m.id}
                <div class="bubble-mine flex flex-col gap-2 w-[420px] max-w-full">
                  <textarea
                    class="textarea bg-black/30"
                    bind:value={editingBody}
                    rows="3"
                  ></textarea>
                  <div class="flex justify-end gap-2">
                    <button type="button" class="btn btn-ghost btn-xs" onclick={cancelEdit}>Cancel</button>
                    <button type="button" class="btn btn-primary btn-xs" onclick={saveEdit}>Save</button>
                  </div>
                </div>
              {:else}
                <div class="{isMine(m) ? 'bubble-mine' : m.internal ? 'bubble-internal' : 'bubble-theirs'}">
                  {#if m.internal === 1}
                    <div class="eyebrow mb-1.5 eyebrow-internal">Internal note · admin only</div>
                  {/if}
                  {#if m.replied_to}
                    <!-- Quoted reply preview: click scrolls + flashes the original message -->
                    <button type="button"
                            class="block w-full text-left mb-2 px-2 py-1.5 rounded border-l-4 text-xs"
                            style="border-color: var(--color-accent); background: var(--accent-wash);"
                            onclick={() => scrollToMessage(m.replied_to!.id)}
                            aria-label="Jump to replied message">
                      <div class="text-fainter mb-0.5">↩ {m.replied_to.sender_email}</div>
                      <div class="truncate text-muted">{m.replied_to.body}{m.replied_to.body.length >= 80 ? '…' : ''}</div>
                    </button>
                  {/if}
                  <div>{@html linkify(m.body)}</div>

                  {#if m.attachments.length}
                    <div class="mt-2 space-y-2">
                      {#each m.attachments as a}
                        {#if isImage(a.mime_type)}
                          <button type="button" class="block p-0 border-0 bg-transparent cursor-zoom-in text-left"
                                  aria-label={`Open ${a.filename}`}
                                  onclick={() => openLightbox(`/api/attachments/${a.id}`, a.filename)}>
                            <img src={`/api/attachments/${a.id}`} alt={a.filename}
                                 loading="lazy" decoding="async"
                                 class="max-h-72 max-w-full sm:max-w-xs rounded-xl border block"
                                 style="border-color: var(--glass-border);" />
                          </button>
                        {:else if isAudio(a.mime_type)}
                          <!-- Voice message: native <audio> controls + Transcribe button. -->
                          <div class="flex flex-col gap-1.5">
                            <audio
                              controls
                              preload="metadata"
                              class="block"
                              style="width: min(20rem, calc(100vw - 7rem)); max-width: 100%;"
                              aria-label={`Voice message: ${a.filename}`}
                            >
                              <!-- WebM/Ogg voice messages also have an AAC rendition: it plays
                                   everywhere, Opus does not on iPhone. -->
                              {#if needsRendition(a.mime_type)}
                                <source src={`/api/attachments/${a.id}?format=m4a`} type="audio/mp4" />
                              {/if}
                              <source src={`/api/attachments/${a.id}`} type={a.mime_type} />
                              Your browser cannot play this audio file.
                            </audio>
                            <span class="text-fainter num text-[10px]">{fmtBytes(a.size_bytes)}</span>

                            {#if a.silent === 1}
                              <!-- The recording holds no sound at all (muted or wrong microphone). -->
                              <p class="text-xs rounded-lg px-2.5 py-1.5" role="note" data-testid="silent-audio"
                                 style="color: var(--color-warn); background: oklch(0.8 0.17 80 / 0.1);">
                                No sound was captured in this recording, so there is nothing to hear.
                                Ask the sender to check their microphone and record it again.
                              </p>
                            {/if}

                            <!-- Transcription section -->
                            {#if a.transcript_status === 'ready' && a.transcript_text}
                              <!-- Transcript text: collapsible via <details> -->
                              <details class="glass-subtle rounded-lg text-xs" open>
                                <summary class="px-2.5 py-1.5 cursor-pointer select-none font-medium"
                                         style="color: var(--color-accent);">
                                  Transcript
                                  {#if a.transcript_lang && a.transcript_lang !== 'auto'}
                                    <span class="text-fainter ml-1">({a.transcript_lang})</span>
                                  {/if}
                                </summary>
                                <p class="px-2.5 pb-2 text-muted leading-relaxed">{a.transcript_text}</p>
                              </details>
                              <!-- Allow re-transcription on request -->
                              <button
                                type="button"
                                class="btn btn-ghost self-start"
                                style="height:24px; font-size:11px; padding: 0 8px;"
                                disabled={transcribingIds.has(a.id)}
                                onclick={() => requestTranscript(a.id)}
                                aria-label="Re-transcribe this voice message"
                              >Re-transcribe</button>
                            {:else if a.transcript_status === 'pending' || transcribingIds.has(a.id)}
                              <div class="flex items-center gap-1.5 text-xs" style="color: var(--color-fainter);">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     stroke-width="2.5" stroke-linecap="round" class="animate-spin" aria-hidden="true">
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                                Transcribing…
                              </div>
                            {:else if a.transcript_status === 'failed'}
                              <div class="flex items-center gap-2">
                                <span class="text-xs" style="color: var(--color-danger, #ef4444);">Transcription failed.</span>
                                <button
                                  type="button"
                                  class="btn btn-ghost"
                                  style="height:24px; font-size:11px; padding: 0 8px;"
                                  disabled={transcribingIds.has(a.id)}
                                  onclick={() => requestTranscript(a.id)}
                                  aria-label="Retry transcription"
                                >Retry</button>
                              </div>
                            {:else}
                              <!-- Not yet transcribed -->
                              <button
                                type="button"
                                class="btn btn-ghost self-start"
                                style="height:24px; font-size:11px; padding: 0 8px;"
                                disabled={transcribingIds.has(a.id)}
                                onclick={() => requestTranscript(a.id)}
                                aria-label="Transcribe this voice message"
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                  <line x1="12" y1="19" x2="12" y2="23" />
                                  <line x1="8" y1="23" x2="16" y2="23" />
                                </svg>
                                Transcribe
                              </button>
                            {/if}
                          </div>
                        {:else if isVideo(a.mime_type)}
                          <!-- Video attachment: native <video> controls.
                               `preload="metadata"` skips the body until the
                               viewer presses play, so a thread with several
                               clips does not wedge mobile bandwidth on load. -->
                          <div class="flex flex-col gap-1">
                            <!-- svelte-ignore a11y_media_has_caption -->
                            <video
                              controls
                              preload="metadata"
                              src={`/api/attachments/${a.id}`}
                              class="block rounded-lg"
                              style="max-width: 360px; max-height: 240px; background: black;"
                              aria-label={`Video: ${a.filename}`}
                            >
                              Your browser cannot play this video file.
                            </video>
                            <div class="flex items-center gap-2 text-fainter num text-[10px]">
                              <span>{a.filename}</span>
                              <span>·</span>
                              <span>{fmtBytes(a.size_bytes)}</span>
                            </div>
                          </div>
                        {:else}
                          <a class="glass-subtle inline-flex items-center gap-2 px-2.5 py-1.5 text-xs no-underline"
                             href={`/api/attachments/${a.id}`}
                             download={a.filename}
                             target="_blank" rel="noopener"
                             aria-label={`Download ${a.filename}`}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span class="font-medium">{a.filename}</span>
                            <span class="text-fainter num">{fmtBytes(a.size_bytes)}</span>
                          </a>
                        {/if}
                      {/each}
                    </div>
                  {/if}

                  {#if m.reactions.length}
                    <div class="flex flex-wrap gap-1.5 mt-2">
                      {#each m.reactions as r}
                        <button
                          type="button"
                          class="chip h-6"
                          style={r.mine
                            ? 'background: var(--accent-wash-strong); border-color: var(--accent-line); color: var(--color-text);'
                            : ''}
                          onclick={() => react(m.id, r.emoji)}
                        >
                          <span>{r.emoji}</span>
                          <span class="num">{r.count}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}

                  {#if showReactionsFor === m.id}
                    <div class="absolute -top-9 right-0 glass-strong flex gap-0.5 px-1.5 py-1 z-10"
                         in:scale={{ start: 0.9, duration: 180, easing: cubicOut }}>
                      {#each REACTIONS as e}
                        <button type="button" class="hover:scale-110 transition-transform px-1.5 py-0.5"
                                onclick={() => react(m.id, e)}>{e}</button>
                      {/each}
                    </div>
                  {/if}
                </div>

                <!-- message actions: hover on desktop (absolute overlay), always visible on touch (inline below bubble) -->
                <div class="msg-actions flex gap-1 {isMine(m) ? 'justify-end' : 'justify-start'}">
                  <!-- Reply button — available on all non-deleted messages (not to users on a closed ticket) -->
                  {#if !m.deleted_at && !(data.ticket.status === 'closed' && !data.isAdmin)}
                    <button type="button" class="btn btn-ghost glass-strong btn-icon"
                            aria-label="Reply to message" onclick={() => startReply(m)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="9 17 4 12 9 7" />
                        <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                      </svg>
                    </button>
                  {/if}
                  <button type="button" class="btn btn-ghost glass-strong btn-icon"
                          aria-label="React" onclick={() => (showReactionsFor = showReactionsFor === m.id ? null : m.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
                    </svg>
                  </button>
                  {#if isMine(m) && !(data.ticket.status === 'closed' && !data.isAdmin)}
                    <button type="button" class="btn btn-ghost glass-strong btn-icon"
                            aria-label="Edit" onclick={() => startEdit(m)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button type="button" class="btn btn-ghost glass-strong btn-icon"
                            aria-label="Delete" onclick={() => deleteMessage(m.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            <!--
              Sent / read receipt: rendered only beneath the viewer's
              most recent own message.

              - Empty (nobody read yet): single muted check + "Sent ·
                not read yet" so the author at least sees that the
                message landed in the inbox.
              - At least one read: accent-coloured double check + the
                list of participants whose last_read_at is later than
                this message's created_at, with the author excluded.

              Refreshes live via the SSE 'read' event so the eyebrow
              flips from "Sent" to "Read by …" the moment a
              participant opens the ticket.
            -->
            {#if m.id === myLastMessageId}
              {@const reads = receiptsFor(m)}
              <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] mt-1 max-w-[78%]"
                   style="color: var(--color-fainter);"
                   aria-label={reads.length > 0 ? 'Read by' : 'Sent — not read yet'}>
                {#if reads.length === 0}
                  <!-- Sent (no participant has opened the ticket since this message).
                       WhatsApp's "sent" tick is the standard grey #8696A0. -->
                  <svg width="14" height="11" viewBox="0 0 18 14" fill="none" stroke="#8696A0"
                       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                       style="flex-shrink: 0;">
                    <polyline points="2 7 6.5 11.5 16 2" />
                  </svg>
                  <span>Sent · not read yet</span>
                {:else}
                  <!-- Read by at least one participant. WhatsApp's "read"
                       double-tick is its brand cyan #53BDEB; the two ticks
                       overlap with the second one starting ~halfway across
                       the first to evoke the familiar glyph. -->
                  <svg width="18" height="11" viewBox="0 0 24 14" fill="none" stroke="#53BDEB"
                       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                       style="flex-shrink: 0;">
                    <polyline points="2 7 6.5 11.5 16 2" />
                    <polyline points="8 7 12.5 11.5 22 2" />
                  </svg>
                  <span>Read by</span>
                  {#each reads as r, i}
                    <span class="inline-flex items-center gap-1">
                      <span style="color: var(--color-text); opacity: 0.85;">{readerLabel(r.email)}</span>
                      <span class="num opacity-70">· {shortTime(r.last_read_at)}</span>
                    </span>
                    {#if i < reads.length - 1}<span class="opacity-50">,</span>{/if}
                  {/each}
                {/if}
              </div>
            {/if}
          </li>
        {/each}

        {#if typingFrom}
          <li><TypingIndicator email={typingFrom.email} /></li>
        {/if}
      </ul>

      <!-- C) Composer · padding-bottom respects iPhone home indicator inset -->
      <div bind:this={composerRef}
           style="padding-bottom: env(safe-area-inset-bottom, 0px);">
        {#if data.ticket.status === 'closed' && !data.isAdmin}
          <!-- Closed tickets take no replies from users; an administrator reviews and reopens. -->
          <div class="border-t p-4 flex flex-wrap items-center gap-3" style="border-color: var(--glass-border);"
               role="status" data-testid="closed-notice">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                 class="shrink-0" style="color: var(--color-muted);">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <p class="text-sm text-muted flex-1 min-w-[200px]">
              This ticket is closed, so replies are off. Only an administrator can reopen it.
              If you need something else, open a new ticket.
            </p>
            <a href="/tickets/new" class="btn btn-primary" data-testid="closed-new-ticket">
              Open a new ticket
            </a>
            {#if error}
              <!-- e.g. a send that was refused because the ticket got closed meanwhile -->
              <p class="basis-full text-sm" style="color: var(--color-danger);" role="alert"
                 data-testid="closed-send-error">{error}</p>
            {/if}
          </div>
        {:else}
        <Composer
          bind:body
          bind:pendingFiles
          bind:asInternal
          bind:textareaRef={composerTextareaRef}
          bind:isChunkedUploading
          bind:chunkedUploadSessionIds
          ticketId={data.ticket.id}
          isAdmin={data.isAdmin}
          {sending}
          {error}
          {replyingTo}
          onSend={send}
          onTyping={pingTyping}
          onApplyTemplate={applyTemplate}
          onCancelReply={cancelReply}
        />
        {/if}
      </div>
    </div>

    <!-- ============== Sidebar inline — desktop only (≥1024px) ============== -->
    <div class="hidden lg:block">
      <TicketSidebar
        ticket={data.ticket}
        {owner}
        isAdmin={data.isAdmin}
        admins={data.admins}
        projects={data.projects}
        allProjects={data.allProjects}
        group={data.group}
        participants={data.participants}
        {notifState}
        tasks={data.tasks}
        canCreateTask={data.isAdmin || data.ticket.user_id === data.currentUserId}
        viewerUserId={data.currentUserId}
        onTasksChanged={() => invalidateAll()}
        bind:editingProjects
        bind:projectDraft
        bind:followerDraft
        onAssign={assignTo}
        onToggleArchive={toggleArchive}
        onToggleProject={toggleProject}
        onSaveProjects={saveProjects}
        onAddFollower={addFollower}
        onRemoveFollower={removeFollower}
        onEnableNotifs={enableBrowserNotifs}
        extensions={data.extensions}
        onExtend={openExtend}
      />
    </div>
  </div>

  <!-- ============== Sidebar drawer — mobile/tablet (<1024px) ============== -->
  {#if infoOpen}
    <div
      class="fixed inset-0 z-[100] lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Ticket info"
    >
      <!-- Backdrop -->
      <button
        type="button"
        class="absolute inset-0 bg-black/75 border-0 p-0 w-full h-full"
        aria-label="Close ticket info"
        onclick={() => (infoOpen = false)}
      ></button>

      <!-- Drawer panel · padding-top respects the iOS notch / status bar -->
      <aside
        class="absolute right-0 top-0 bottom-0 w-80 max-w-[90vw] overflow-y-auto px-4 pb-4"
        style="padding-top: calc(1rem + env(safe-area-inset-top, 0px)); background: var(--glass-strong-bg, oklch(0.14 0.04 270 / 0.96)); border-left: 1px solid var(--glass-border); backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);"
        transition:fly={{ x: 320, duration: 220, easing: cubicOut }}
      >
        <button
          type="button"
          class="btn btn-ghost float-right mb-2 btn-lg btn-icon"
          aria-label="Close ticket info"
          onclick={() => (infoOpen = false)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <TicketSidebar
          ticket={data.ticket}
          {owner}
          isAdmin={data.isAdmin}
          admins={data.admins}
          projects={data.projects}
          allProjects={data.allProjects}
          group={data.group}
          participants={data.participants}
          {notifState}
          tasks={data.tasks}
          canCreateTask={data.isAdmin || data.ticket.user_id === data.currentUserId}
          viewerUserId={data.currentUserId}
          onTasksChanged={() => invalidateAll()}
          bind:editingProjects
          bind:projectDraft
          bind:followerDraft
          onAssign={assignTo}
          onToggleArchive={toggleArchive}
          onToggleProject={toggleProject}
          onSaveProjects={saveProjects}
          onAddFollower={addFollower}
          onRemoveFollower={removeFollower}
          onEnableNotifs={enableBrowserNotifs}
          extensions={data.extensions}
          onExtend={() => { infoOpen = false; openExtend(); }}
        />
      </aside>
    </div>
  {/if}
</section>

<form
  bind:this={extendForm}
  method="POST"
  action="?/extend"
  class="hidden"
  use:enhance={() => {
    extendBusy = true;
    return async ({ result, update }) => {
      extendBusy = false;
      if (result.type === 'failure') {
        extendError = (result.data?.extendError as string) ?? 'Could not extend the time.';
        return;
      }
      if (result.type === 'success') extendOpen = false;
      await update({ reset: false });
    };
  }}
>
  <input type="hidden" name="hours" value={extendHours} />
  <input type="hidden" name="reason" value={extendReason} />
</form>

<ExtendTimeModal
  open={extendOpen}
  remaining={slaText}
  busy={extendBusy}
  error={extendError}
  onconfirm={confirmExtend}
  oncancel={() => (extendOpen = false)}
/>

<svelte:window onpopstate={onPopState} />

{#if lightbox}
  <ImageLightbox src={lightbox.src} alt={lightbox.alt} onclose={closeLightbox} />
{/if}

<style>
  /* Chat shell sizing.
     Goal: the chat fills exactly the visible viewport minus the navbar,
     so the page itself never scrolls. Only the messages list inside
     scrolls. When the on-screen keyboard opens, `100dvh` shrinks (iOS
     opts in via `interactive-widget=resizes-content`) and the flex
     layout reflows: messages list shrinks, composer stays glued to the
     bottom edge — no gap below the composer. */
  .chat-shell {
    /* Mobile: full-bleed. `--chrome-h` is the measured height of the navbar
       plus any banner above <main> (set by +layout.svelte); the fallback is
       the bare navbar (~60px) plus the iOS notch inset. We prefer the JS-driven
       `--vv-h` (window.visualViewport.height) over `100dvh` because
       only the former reliably shrinks when the iOS on-screen keyboard
       opens — `100dvh` lags or is unsupported in older Safari. */
    height: calc(var(--vv-h, 100dvh) - var(--chrome-h, calc(60px + env(safe-area-inset-top, 0px))));
    min-height: 0;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
  @media (min-width: 640px) {
    .chat-shell {
      /* Tablet+: the section gets 40px of py-5 padding back, so subtract
         it from the available height. Restore card visuals. */
      height: calc(var(--vv-h, 100dvh) - var(--chrome-h, 60px) - 40px);
      min-height: 480px;
      border-radius: var(--radius-panel);
      border-left: 1px solid var(--glass-border);
      border-right: 1px solid var(--glass-border);
    }
  }
  /* Landscape phones are wider than 640px but only ~390px tall: the tablet
     minimum height would push the composer below the screen. */
  @media (min-width: 640px) and (max-height: 520px) {
    .chat-shell {
      min-height: 0;
    }
  }

  /* Message action buttons.
     Hover-capable devices (desktop): absolute overlay at the bottom of the
     bubble wrapper — hidden by default, shown on group hover.
     Touch devices: static inline row below the bubble — always visible so
     the buttons are reachable without a hover interaction. */
  @media (hover: hover) and (pointer: fine) {
    .msg-actions {
      position: absolute;
      bottom: -20px;
      right: 0;
      opacity: 0;
      transition: opacity 120ms;
    }
    :global(.group:hover) .msg-actions {
      opacity: 1;
    }
  }
  @media (hover: none), (pointer: coarse) {
    .msg-actions {
      position: static;
      opacity: 1;
      margin-top: 4px;
    }
  }
</style>
