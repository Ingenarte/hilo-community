<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';
  import ThemeToggle from '$lib/ThemeToggle.svelte';
  import KeyboardShortcuts from '$lib/KeyboardShortcuts.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import LogoutButton from '$lib/LogoutButton.svelte';
  import {
    clearActivity,
    getSoundEnabled,
    installActivityListeners,
    setSoundEnabled,
    setUnreadTotal
  } from '$lib/activity';
  import {
    enableNotifications,
    ensurePushSubscription,
    maybeNotify,
    notifyState,
    type NotifyState
  } from '$lib/notifications';
  import InstallButton from '$lib/InstallButton.svelte';
  import TimelineButton from '$lib/TimelineButton.svelte';
  import HelpButton from '$lib/HelpButton.svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Props = {
    data: {
      user: { email: string; role: 'user' | 'admin' } | null;
      theme: 'dark' | 'light';
      accent: 'violet' | 'cyan' | 'emerald' | 'amber';
      unreadTotal?: number;
      seenInstallHelpAt?: number | null;
    };
    children: import('svelte').Snippet;
  };

  const { data, children }: Props = $props();

  // Routes that hide the global chrome (no session yet). The public landing
  // at `/` also hides it — it renders its own minimal header.
  const HIDE_CHROME = ['/login'];
  const showChrome = $derived(
    !HIDE_CHROME.some((p) => $page.url.pathname.startsWith(p)) &&
      !($page.url.pathname === '/' && !data.user)
  );

  function isActive(prefix: string): boolean {
    const path = $page.url.pathname;
    if (prefix === '/tickets') return path === '/tickets' || path.startsWith('/tickets/');
    if (prefix === '/admin') return path === '/admin';
    return path.startsWith(prefix);
  }

  // Subscribe to the per-user activity SSE feed so badge/sound work
  // anywhere in the app — not just on the ticket detail page.
  let es: EventSource | null = null;
  // When `true`, the next layout reload (driven by an SSE activity
  // event) will refresh badges without re-playing the ping. Used when
  // the user is already focused on the same ticket the message came in
  // on — the per-ticket SSE handles the visual update there.
  let ssePayloadSilent = $state(false);

  // React to server-provided unread totals. This is the single source
  // of truth for badge values; in-memory increments only exist as a
  // fallback for components that don't have access to the layout data.
  $effect(() => {
    const n = data.unreadTotal ?? 0;
    setUnreadTotal(n, { silent: ssePayloadSilent });
    ssePayloadSilent = false;
  });

  // First-run notifications prompt + global refresh state.
  // - notifPromptVisible drives the slim banner that asks for permission.
  //   It only appears when the browser has never been asked AND the user
  //   hasn't dismissed the prompt before.
  // - refreshing animates the navbar icon while invalidateAll runs.
  const NOTIF_DISMISS_KEY = 'hilo.notify.dismissed';
  let notifStateNow = $state<NotifyState>('default');
  let notifPromptVisible = $state(false);
  let refreshing = $state(false);
  let soundOn = $state(true);

  function toggleSound() {
    soundOn = !soundOn;
    setSoundEnabled(soundOn);
  }

  function recomputeNotifPrompt() {
    notifStateNow = notifyState();
    notifPromptVisible =
      notifStateNow === 'default' &&
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(NOTIF_DISMISS_KEY) !== '1';
  }

  async function turnOnNotifications() {
    const next = await enableNotifications();
    notifStateNow = next;
    notifPromptVisible = false;
    if (next === 'granted-on') {
      // Subscribe to Web Push so the OS-level dock badge / notification
      // popups fire even when Hilo isn't focused.
      ensurePushSubscription().catch(() => undefined);
    }
  }

  function dismissNotifPrompt() {
    notifPromptVisible = false;
    try {
      localStorage.setItem(NOTIF_DISMISS_KEY, '1');
    } catch {
      // ignore
    }
  }

  // Mobile nav drawer state
  let navOpen = $state(false);

  async function manualRefresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await invalidateAll();
    } finally {
      // small floor so the spin animation is visible even on fast refreshes
      setTimeout(() => (refreshing = false), 400);
    }
  }

  // Track the visual viewport (visible area minus on-screen keyboard,
  // browser URL bar, etc.) and publish it as `--vv-h` on <html>. CSS
  // can then size full-viewport panels with `var(--vv-h, 100dvh)` and
  // get pixel-accurate sizing on iOS Safari, where `100dvh` alone
  // either lags or (pre-17.4) does not resize at all when the
  // on-screen keyboard opens.
  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function syncVV() {
      document.documentElement.style.setProperty('--vv-h', `${vv!.height}px`);
    }
    syncVV();
    vv.addEventListener('resize', syncVV);
    vv.addEventListener('scroll', syncVV);
    return () => {
      vv.removeEventListener('resize', syncVV);
      vv.removeEventListener('scroll', syncVV);
    };
  });

  onMount(() => {
    // Register the service worker on every load so Chrome's install
    // heuristic sees the worker active. The push subscription still
    // requires Notification permission, but the SW registration itself
    // is free and unblocks install.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Network or syntax errors are non-fatal — the app still runs,
        // just without push or install.
      });
    }
    if (!data.user) return;
    recomputeNotifPrompt();
    // Sync the navbar mute toggle with whatever the user picked last session.
    soundOn = getSoundEnabled();
    // If permission was already granted in a previous session, re-attach
    // the push subscription opportunistically.
    if (notifStateNow === 'granted-on' || notifStateNow === 'granted-off') {
      ensurePushSubscription().catch(() => undefined);
    }
  });
  onMount(() => {
    if (!data.user) return;
    installActivityListeners();
    // Defer SSE connection by 100 ms so the initial paint (LCP) completes
    // before the browser opens the long-lived HTTP connection. This reduces
    // total-blocking-time on first load without affecting perceived latency.
    const sseTimer = setTimeout(() => {
    try {
      es = new EventSource('/api/events/stream');
      es.addEventListener('activity', (ev) => {
        let payload: {
          ticketId?: number;
          title?: string;
          sender?: string;
          preview?: string;
        } = {};
        try {
          payload = JSON.parse((ev as MessageEvent).data);
        } catch {
          // ignore
        }
        const path = $page.url.pathname;
        const focusedOnSameTicket =
          payload.ticketId &&
          path === `/tickets/${payload.ticketId}` &&
          !document.hidden;
        // When focused on the same ticket, the per-ticket SSE already
        // shows the new message — we still invalidate so unread state
        // updates, but flag silent so no redundant ping fires.
        ssePayloadSilent = !!focusedOnSameTicket;
        invalidateAll();
        // OS-level Notification API banner — fires only when the tab is
        // not focused (maybeNotify enforces that). Title carries the
        // sender so the user can triage without opening Hilo. Skip when
        // we're already on that ticket route: the per-ticket SSE on the
        // detail page handles its own notification, and otherwise an
        // auto-fired click on Linux daemons would reload us in place.
        const targetPath = `/tickets/${payload.ticketId}`;
        if (payload.ticketId && payload.title && $page.url.pathname !== targetPath) {
          maybeNotify({
            title: payload.sender
              ? `${payload.sender} · ${payload.title}`
              : payload.title,
            body: payload.preview ?? '',
            tag: `hilo-${payload.ticketId}`,
            onClickUrl: targetPath
          });
        }
      });
    } catch {
      // EventSource may be blocked; just give up silently.
    }
    }, 100);
    return () => {
      clearTimeout(sseTimer);
      es?.close();
      es = null;
      clearActivity();
    };
  });
</script>

<svelte:head>
  <link rel="icon" href="/favicon.svg" />
</svelte:head>

{#if showChrome && data.user}
  <header
    class="sticky top-0 z-30"
    style="
      background: var(--glass-tint-subtle);
      border-bottom: 1px solid var(--glass-border);
      backdrop-filter: blur(24px) saturate(160%);
      -webkit-backdrop-filter: blur(24px) saturate(160%);
      box-shadow: 0 1px 0 0 var(--glass-border);
      padding-top: env(safe-area-inset-top, 0px);
      padding-left: env(safe-area-inset-left, 0px);
      padding-right: env(safe-area-inset-right, 0px);
    ">
    <div class="max-w-6xl mx-auto px-4 lg:px-8 flex items-center gap-3 py-2.5">
      <a href="/tickets" class="flex items-center gap-2 mr-2" aria-label="hilo home">
        <img src="/favicon.svg" alt="" width="22" height="22" />
        <span class="font-bold text-[15px] tracking-tight">hilo</span>
      </a>
      <span class="h-4 w-px hidden sm:block" style="background: var(--glass-border);"></span>

      <!-- Nav inline — visible only on sm+ (≥640px) -->
      <nav class="hidden sm:flex items-center gap-0.5">
        <a href="/tickets"
           class="btn btn-ghost inline-flex items-center gap-1.5"
           style="height:32px;"
           aria-current={isActive('/tickets') ? 'page' : undefined}
           class:bg-active={isActive('/tickets')}>
          Tickets
          {#if (data.unreadTotal ?? 0) > 0}
            <span
              class="badge-unread"
              aria-label={(data.unreadTotal ?? 0) > 9
                ? `more than 9 unread tickets`
                : `${data.unreadTotal} unread tickets`}
            >
              {(data.unreadTotal ?? 0) > 9 ? '9+' : data.unreadTotal}
            </span>
          {/if}
        </a>

        {#if data.user.role === 'admin'}
          <a href="/admin" class="btn btn-ghost" style="height:32px;"
             aria-current={isActive('/admin') ? 'page' : undefined}>Admin</a>
          <a href="/admin/users" class="btn btn-ghost" style="height:32px;"
             aria-current={isActive('/admin/users') ? 'page' : undefined}>Users</a>
          <a href="/admin/groups" class="btn btn-ghost" style="height:32px;"
             aria-current={isActive('/admin/groups') ? 'page' : undefined}>Groups</a>
          <a href="/admin/projects" class="btn btn-ghost" style="height:32px;"
             aria-current={isActive('/admin/projects') ? 'page' : undefined}>Projects</a>
          <a href="/admin/outbox" class="btn btn-ghost" style="height:32px;"
             aria-current={isActive('/admin/outbox') ? 'page' : undefined}>Outbox</a>
          <a href="/admin/audit" class="btn btn-ghost" style="height:32px;"
             aria-current={isActive('/admin/audit') ? 'page' : undefined}>Audit</a>
        {/if}

        <a href="/preferences" class="btn btn-ghost" style="height:32px;"
           aria-current={isActive('/preferences') ? 'page' : undefined}>Preferences</a>
      </nav>

      <span class="flex-1"></span>

      <!-- Install button — hidden on mobile (moved to drawer) -->
      <span class="hidden sm:inline-flex">
        <InstallButton />
      </span>

      <!-- Refresh — always visible -->
      <button
        type="button"
        class="btn btn-ghost"
        style="height:40px; width:40px; padding:0;"
        aria-label="Refresh"
        title="Refresh"
        onclick={manualRefresh}
        disabled={refreshing}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
             class={refreshing ? 'animate-spin' : ''}>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>

      <!-- "What's new" bell — lights up when the deploy timeline has a
           new entry the viewer has not seen yet. -->
      <TimelineButton />

      <!-- Help — per-platform install guide (iOS / Android / Windows / macOS)
           with Remotion walkthrough videos and the start-at-login command. -->
      <HelpButton
        seenInstallHelpAt={data.seenInstallHelpAt ?? null}
        onFirstClose={async () => {
          await fetch('/api/me/seen-install-help', { method: 'POST' });
          await invalidateAll();
        }}
      />

      <!-- Mute — hidden on mobile (moved to drawer) -->
      <button
        type="button"
        class="btn btn-ghost hidden sm:inline-flex"
        style="height:40px; width:40px; padding:0;"
        aria-label={soundOn ? 'Mute notifications' : 'Unmute notifications'}
        aria-pressed={!soundOn}
        title={soundOn ? 'Mute notifications' : 'Unmute notifications'}
        onclick={toggleSound}
      >
        {#if soundOn}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        {/if}
      </button>

      <!-- Theme toggle — hidden on mobile (moved to drawer) -->
      <span class="hidden sm:inline-flex">
        <ThemeToggle theme={data.theme} />
      </span>

      <!-- Avatar — always visible -->
      <a href="/preferences" class="ml-1" aria-label="account">
        <Avatar email={data.user.email} size={40} />
      </a>

      <!-- Logout — hidden on mobile (moved to drawer) -->
      <span class="hidden sm:inline-flex">
        <LogoutButton email={data.user.email} />
      </span>

      <!-- Hamburger — mobile only (< 640px) -->
      <button
        type="button"
        class="btn btn-ghost sm:hidden"
        style="height:40px; width:40px; padding:0;"
        aria-label="Open menu"
        aria-expanded={navOpen}
        onclick={() => (navOpen = true)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    </div>
  </header>

  <!-- Mobile nav drawer — only rendered when open, only shown below 640px -->
  {#if navOpen}
    <div
      class="fixed inset-0 z-[100] sm:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      <!-- Backdrop -->
      <button
        type="button"
        class="absolute inset-0 bg-black/75 border-0 p-0 w-full h-full"
        aria-label="Close menu"
        onclick={() => (navOpen = false)}
      ></button>

      <!-- Drawer panel · padding-top respects the iOS notch / status bar -->
      <aside
        class="absolute right-0 top-0 bottom-0 w-72 max-w-[85vw] flex flex-col gap-1 px-4 pb-4 overflow-y-auto"
        style="padding-top: calc(1rem + env(safe-area-inset-top, 0px)); background: var(--glass-strong-bg, oklch(0.14 0.04 270 / 0.96)); border-left: 1px solid var(--glass-border); backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);"
        transition:fly={{ x: 288, duration: 220, easing: cubicOut }}
      >
        <!-- Close button -->
        <button
          type="button"
          class="btn btn-ghost self-end mb-2"
          style="height:40px; width:40px; padding:0;"
          aria-label="Close menu"
          onclick={() => (navOpen = false)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <!-- Nav links -->
        <a href="/tickets"
           class="btn btn-ghost justify-start inline-flex items-center gap-2"
           style="height:44px;"
           aria-current={isActive('/tickets') ? 'page' : undefined}
           onclick={() => (navOpen = false)}>
          Tickets
          {#if (data.unreadTotal ?? 0) > 0}
            <span class="badge-unread ml-auto">
              {(data.unreadTotal ?? 0) > 9 ? '9+' : data.unreadTotal}
            </span>
          {/if}
        </a>

        {#if data.user.role === 'admin'}
          <a href="/admin" class="btn btn-ghost justify-start" style="height:44px;"
             aria-current={isActive('/admin') ? 'page' : undefined}
             onclick={() => (navOpen = false)}>Admin</a>
          <a href="/admin/users" class="btn btn-ghost justify-start" style="height:44px;"
             aria-current={isActive('/admin/users') ? 'page' : undefined}
             onclick={() => (navOpen = false)}>Users</a>
          <a href="/admin/groups" class="btn btn-ghost justify-start" style="height:44px;"
             aria-current={isActive('/admin/groups') ? 'page' : undefined}
             onclick={() => (navOpen = false)}>Groups</a>
          <a href="/admin/projects" class="btn btn-ghost justify-start" style="height:44px;"
             aria-current={isActive('/admin/projects') ? 'page' : undefined}
             onclick={() => (navOpen = false)}>Projects</a>
          <a href="/admin/outbox" class="btn btn-ghost justify-start" style="height:44px;"
             aria-current={isActive('/admin/outbox') ? 'page' : undefined}
             onclick={() => (navOpen = false)}>Outbox</a>
          <a href="/admin/audit" class="btn btn-ghost justify-start" style="height:44px;"
             aria-current={isActive('/admin/audit') ? 'page' : undefined}
             onclick={() => (navOpen = false)}>Audit</a>
        {/if}

        <a href="/preferences" class="btn btn-ghost justify-start" style="height:44px;"
           aria-current={isActive('/preferences') ? 'page' : undefined}
           onclick={() => (navOpen = false)}>Preferences</a>

        <!-- Settings section divider -->
        <hr class="my-2 border-t" style="border-color: var(--glass-border);" />
        <span class="text-fainter text-xs px-2 pb-1">Settings</span>

        <!-- Mute toggle in drawer -->
        <button
          type="button"
          class="btn btn-ghost justify-start"
          style="height:44px;"
          aria-label={soundOn ? 'Mute notifications' : 'Unmute notifications'}
          aria-pressed={!soundOn}
          onclick={toggleSound}
        >
          {#if soundOn}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
            Mute notifications
          {:else}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
            Unmute notifications
          {/if}
        </button>

        <!-- Theme toggle in drawer -->
        <div class="px-2 flex items-center justify-between" style="height:44px;">
          <span class="text-sm">Theme</span>
          <ThemeToggle theme={data.theme} />
        </div>

        <!-- Install button in drawer -->
        <div class="px-2 flex items-center justify-between" style="height:44px;">
          <span class="text-sm">Install app</span>
          <InstallButton />
        </div>

        <hr class="my-2 border-t" style="border-color: var(--glass-border);" />

        <!-- Logout in drawer -->
        <div class="flex items-center gap-3 px-2" style="height:44px;">
          <span class="text-sm flex-1 truncate text-muted">{data.user.email}</span>
          <LogoutButton email={data.user.email} />
        </div>
      </aside>
    </div>
  {/if}

  {#if notifPromptVisible}
    <div
      class="border-b"
      style="background: oklch(0.74 0.18 295 / 0.07); border-color: var(--glass-border);"
    >
      <div
        class="max-w-6xl mx-auto px-4 lg:px-8 py-2.5 flex items-center gap-3 text-sm"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
             style="color: var(--color-accent); flex-shrink:0;">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span class="flex-1">
          <strong>Get notified of new activity.</strong>
          <span class="text-muted">
            Allow desktop notifications so you don't miss replies when
            Hilo isn't in the foreground.
          </span>
        </span>
        <button class="btn btn-primary" style="height:28px;" onclick={turnOnNotifications}>
          Enable
        </button>
        <button class="btn btn-ghost" style="height:28px;" onclick={dismissNotifPrompt}>
          Not now
        </button>
      </div>
    </div>
  {/if}
{/if}

<main class="min-h-[calc(100dvh-0px)]">
  {@render children()}
</main>

{#if data.user}
  <KeyboardShortcuts />
{/if}

<style>
  /* highlight the active nav button — Svelte's class:bg-active above uses this */
  :global([aria-current="page"]) {
    color: var(--color-text) !important;
    background: var(--glass-tint) !important;
    border-color: var(--glass-border) !important;
  }
</style>
