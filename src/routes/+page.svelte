<script lang="ts">
  import { env as pubEnv } from '$env/dynamic/public';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  const BRAND = pubEnv.PUBLIC_BRAND || 'Hilo';
  const BASE_URL = pubEnv.PUBLIC_BASE_URL || 'http://localhost:5180';
  // Upstream open-source repository advertised on the landing page.
  const REPO_URL = 'https://github.com/Ingenarte/hilo-community';
  // Optional: name of the organization hosting this instance (e.g. "Ingenarte").
  // When unset, the owner-specific copy is omitted.
  const OWNER = pubEnv.PUBLIC_INSTANCE_OWNER || '';

  // Mirrors the ten chapters of the promo video (video-remotion Promo).
  const FEATURES = [
    {
      title: 'Threaded tickets, realtime chat',
      body: 'One thread per topic with live updates over server-sent events — typing indicators, reactions and message editing included.'
    },
    {
      title: 'Voice, transcribed on your hardware',
      body: 'Record voice notes up to two minutes and transcribe them with one tap on a self-hosted Whisper engine. Dictation streams speech straight into the composer.'
    },
    {
      title: 'Files that actually arrive',
      body: 'Resumable chunked uploads up to 500 MB that survive reloads and flaky connections, with inline images and seekable video previews.'
    },
    {
      title: 'Know what was seen',
      body: 'Read receipts with reader name and time, unread stripes and badges, and an inbox eye that shows whether your latest reply was seen.'
    },
    {
      title: 'Tasks inside the conversation',
      body: 'Create and assign tasks to any participant without leaving the ticket. Pending-task chips surface right in the inbox.'
    },
    {
      title: 'Email that works both ways',
      body: 'Rich themed notification emails with magic-link sign-in that lands on the exact conversation — and inbound email becomes a ticket automatically.'
    },
    {
      title: 'Notifications on your terms',
      body: 'Web push on desktop and mobile, per-user quiet hours, and digest throttling so nobody is ever spammed.'
    },
    {
      title: 'Built for operators',
      body: 'Projects, groups and per-user access, a full audit log, canned templates, outbound webhooks, health endpoint and Prometheus metrics.'
    },
    {
      title: 'Installs like a native app',
      body: 'PWA install on iOS, Android, Windows and macOS with guided videos for each platform. Dark and light themes with four accent colors.'
    },
    {
      title: 'Find it, export it, wire it up',
      body: 'Full-text search across every message, CSV export per ticket or workspace-wide, and Slack / Discord / generic webhooks.'
    }
  ];
</script>

<svelte:head>
  <title>{BRAND} — self-hosted tickets + chat for small teams</title>
  <meta
    name="description"
    content="Hilo is a free, open-source, self-hosted ticket and chat platform: realtime threads, voice notes with on-device transcription, resumable uploads, tasks, magic-link email and web push." />
  <link rel="canonical" href={BASE_URL} />
  <meta property="og:title" content="{BRAND} — self-hosted tickets + chat" />
  <meta property="og:description" content="Free and open source. Clone it, run docker compose up, and own your support stack." />
  <meta property="og:image" content="{BASE_URL}/og-card.png" />
  <meta property="og:type" content="website" />
</svelte:head>

<div class="min-h-screen">
  <!-- Minimal public header -->
  <header class="flex items-center gap-3 px-5 sm:px-10 py-4 max-w-6xl mx-auto">
    <img src="/favicon.svg" alt="" width="30" height="30" />
    <span class="text-lg font-extrabold tracking-tight">{BRAND}</span>
    <span class="flex-1"></span>
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener"
      class="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
      style="border: 1px solid var(--color-border); color: var(--color-text);">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
      GitHub
    </a>
    <a
      href="/login"
      class="inline-flex items-center px-4 py-2 rounded-xl text-sm font-bold"
      style="background: var(--color-accent); color: #fff;">
      Log in
    </a>
  </header>

  <!-- Hero -->
  <section class="max-w-6xl mx-auto px-5 sm:px-10 pt-10 sm:pt-16 pb-10 text-center"
           in:fly={{ y: 18, duration: 500, easing: cubicOut }}>
    <h1 class="text-4xl sm:text-6xl font-black tracking-tight leading-tight mb-5">
      Self-hosted tickets + chat<br class="hidden sm:block" />
      for small teams.
    </h1>
    <p class="text-base sm:text-lg text-muted max-w-2xl mx-auto mb-8">
      All the support tooling you actually need — realtime threads, voice notes,
      big file uploads, tasks and notifications — running on your own server.
      Free and open source.
    </p>
    <div class="flex items-center justify-center gap-3 flex-wrap">
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-bold"
        style="background: var(--color-accent); color: #fff;">
        Get the code — it's open source
      </a>
      <a
        href="/login"
        class="inline-flex items-center px-6 py-3 rounded-2xl font-semibold"
        style="border: 1px solid var(--color-border); color: var(--color-text);">
        Log in{#if OWNER}&nbsp;· {OWNER} users{/if}
      </a>
    </div>
  </section>

  <!-- Promo video -->
  <section class="max-w-5xl mx-auto px-5 sm:px-10 pb-14">
    <div class="glass-strong overflow-hidden" style="padding: 0; border-radius: 22px;">
      <video
        controls
        preload="none"
        poster="/promo.jpg"
        src="/promo.mp4"
        style="display: block; width: 100%; aspect-ratio: 16 / 9; background: #0b0f1a;">
        <track kind="captions" />
      </video>
    </div>
  </section>

  <!-- Numbered features -->
  <section class="max-w-6xl mx-auto px-5 sm:px-10 pb-16">
    <div class="eyebrow mb-6 text-center">Ten things it does really well</div>
    <div class="grid gap-4 sm:grid-cols-2">
      {#each FEATURES as f, i}
        <div class="glass-strong p-6" style="border-radius: 18px;">
          <div class="flex items-start gap-4">
            <span
              class="font-black text-2xl tabular-nums"
              style="color: var(--color-accent); font-variant-numeric: tabular-nums; min-width: 2.4rem;">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <h2 class="font-bold text-base mb-1.5">{f.title}</h2>
              <p class="text-sm text-muted leading-relaxed">{f.body}</p>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Open source CTA -->
  <section class="max-w-4xl mx-auto px-5 sm:px-10 pb-20 text-center">
    <div class="glass-strong p-8 sm:p-10" style="border-radius: 24px;">
      <h2 class="text-2xl sm:text-3xl font-black tracking-tight mb-3">Free & open source</h2>
      <p class="text-muted mb-6 max-w-xl mx-auto">
        MIT-licensed and self-contained: SvelteKit, SQLite and Docker.
        Clone the repository, run <code class="font-mono">docker compose up</code>,
        and own your support stack in minutes.
      </p>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-bold font-mono text-sm sm:text-base"
        style="background: var(--color-accent); color: #fff;">
        github.com/Ingenarte/hilo-community
      </a>
    </div>
  </section>

  <footer class="max-w-6xl mx-auto px-5 sm:px-10 pb-10 text-center text-sm text-fainter">
    {BRAND} ·
    {#if OWNER}This instance is hosted by {OWNER} — accounts are invite-only.{:else}Accounts on this instance are invite-only.{/if}
    <a href="/login" style="color: var(--color-accent);">Log in</a> ·
    <a href={REPO_URL} target="_blank" rel="noopener" style="color: var(--color-accent);">Source on GitHub</a>
  </footer>
</div>
