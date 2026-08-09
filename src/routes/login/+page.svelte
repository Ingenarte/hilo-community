<script lang="ts">
  import { enhance } from '$app/forms';
  import { fly, scale, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onMount, tick } from 'svelte';
  import { env as pubEnv } from '$env/dynamic/public';
  import InstallButton from '$lib/InstallButton.svelte';

  // Instance identity comes from runtime env so the same code serves any
  // self-hosted deployment (see .env.example: PUBLIC_SUPPORT_EMAIL).
  const supportEmail = pubEnv.PUBLIC_SUPPORT_EMAIL || '';

  type Props = {
    form?: { error?: string; email?: string } | null;
    data: { dynamicEnabled: boolean };
  };

  const { form, data }: Props = $props();

  let submitting = $state(false);
  let emailRef = $state<HTMLInputElement | null>(null);
  let showPassword = $state(false);

  // "What is Hilo?" modal — explains the product to first-time visitors
  // who land on /login with no context.
  let showAbout = $state(false);
  let infoBtnRef = $state<HTMLButtonElement | null>(null);
  let aboutCloseRef = $state<HTMLButtonElement | null>(null);

  async function openAbout() {
    showAbout = true;
    await tick();
    aboutCloseRef?.focus();
  }
  function closeAbout() {
    showAbout = false;
    // Return focus to the trigger so keyboard navigation is preserved.
    infoBtnRef?.focus();
  }

  onMount(() => {
    emailRef?.focus();
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && showAbout) {
        e.stopPropagation();
        closeAbout();
      }
    }
    document.addEventListener('keydown', onKeydown, { capture: true });
    return () => document.removeEventListener('keydown', onKeydown, { capture: true });
  });
</script>

<main class="min-h-[78vh] flex items-center justify-center px-4 py-12">
  <div
    class="glass-strong w-full max-w-md p-7"
    in:scale={{ start: 0.96, duration: 420, easing: cubicOut, opacity: 0 }}
  >
    <header class="flex items-center gap-3 mb-6">
      <span class="anim-pulse-glow inline-flex">
        <img src="/favicon.svg" alt="" width="36" height="36"
             fetchpriority="high"
             style="filter: drop-shadow(0 4px 14px oklch(0.74 0.18 295 / 0.5));" />
      </span>
      <div class="flex-1 flex items-center gap-2">
        <h1 class="text-lg font-bold tracking-tight">Sign in to hilo</h1>
        <button
          bind:this={infoBtnRef}
          type="button"
          class="btn btn-ghost shrink-0"
          style="height: 28px; width: 28px; padding: 0; border-radius: 999px;"
          aria-label="What is Hilo?"
          aria-expanded={showAbout}
          title="What is Hilo?"
          onclick={openAbout}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
      </div>
      <!--
        The global navbar is hidden on /login, so put the install
        affordance here directly. InstallButton self-hides when the
        browser doesn't expose an install path (e.g. already standalone,
        Firefox desktop, Safari macOS) — on iOS Safari it opens the
        Add-to-Home-Screen guide modal.
      -->
      <InstallButton />
    </header>

    {#if form?.error}
      <div
        class="mb-4 rounded-xl px-3 py-2.5 text-sm error-bubble"
        in:fly={{ y: -6, duration: 240, easing: cubicOut }}
        role="alert"
      >
        {form.error}
      </div>
    {/if}

    <form
      method="POST"
      class="flex flex-col gap-4"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          await update({ reset: false });
          submitting = false;
        };
      }}
    >
      <!-- honeypot -->
      <div aria-hidden="true"
           style="position:absolute; left:-9999px; width:0; height:0; overflow:hidden;">
        <label for="company">Company</label>
        <input id="company" name="company" type="text" tabindex="-1" autocomplete="off" />
      </div>

      <div>
        <label for="email" class="label block mb-1.5">Email</label>
        <input
          bind:this={emailRef}
          id="email"
          name="email"
          type="email"
          autocomplete="email"
          required
          class="input"
          placeholder=""
          value={form?.email ?? ''}
        />
      </div>

      <div>
        <label for="fixed" class="label block mb-1.5">Password</label>
        <div class="relative">
          <input
            id="fixed"
            name="fixed"
            type={showPassword ? 'text' : 'password'}
            autocomplete="current-password"
            required
            class="input"
            style="padding-right: 2.5rem;"
            placeholder=""
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex items-center justify-center"
            style="width: 2.5rem; color: var(--color-muted);"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            title={showPassword ? 'Hide password' : 'Show password'}
            onclick={() => (showPassword = !showPassword)}
          >
            {#if showPassword}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            {:else}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            {/if}
          </button>
        </div>
      </div>

      {#if data.dynamicEnabled}
        <div>
          <label for="dynamic" class="label block mb-1.5">Access code</label>
          <input
            id="dynamic"
            name="dynamic"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            required
            class="input font-mono tracking-widest"
            placeholder="••••••"
          />
        </div>
      {/if}

      <label class="flex items-center gap-2.5 mt-1 py-2 select-none cursor-pointer">
        <input
          id="remember"
          name="remember"
          type="checkbox"
          checked
          class="h-5 w-5 rounded border-gray-400/60"
          style="accent-color: var(--color-accent, oklch(0.74 0.18 295));"
        />
        <span class="text-sm">Remember me on this device</span>
      </label>

      <button
        type="submit"
        class="btn btn-primary mt-2 h-11 w-full text-sm"
        disabled={submitting}
      >
        {#if submitting}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" class="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Signing you in…
        {:else}
          Sign in
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        {/if}
      </button>

      <!-- <p class="text-fainter text-center text-[11px] leading-relaxed mt-1">
        By signing in you accept that this is a low-security guest area.
      </p> -->
    </form>
  </div>
</main>

{#if showAbout}
  <!--
    "What is Hilo?" modal. Triggered from the (?) icon next to the
    login title. ESC closes via the document keydown handler in the
    script; backdrop click and the X button also close. We deliberately
    do NOT set font-family or font-feature-settings here so the panel
    inherits `var(--font-sans)` + the global `font-feature-settings:
    normal` from body — that was the fix for the Android Roboto "B"
    rendering bug and must be preserved.
  -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center px-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="about-hilo-title"
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 bg-black/75 border-0 p-0 w-full h-full cursor-default"
      aria-label="Close"
      tabindex="-1"
      onclick={closeAbout}
    ></button>

    <div
      class="glass-strong relative z-10 w-full max-w-md p-6"
      style="padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));"
      transition:scale={{ start: 0.96, duration: 220, easing: cubicOut, opacity: 0 }}
    >
      <button
        bind:this={aboutCloseRef}
        type="button"
        class="btn btn-ghost absolute top-3 right-3"
        style="height: 32px; width: 32px; padding: 0; border-radius: 999px;"
        aria-label="Close"
        onclick={closeAbout}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      <h2 id="about-hilo-title" class="text-lg font-bold tracking-tight mb-3 pr-8">
        What is Hilo?
      </h2>

      <p class="text-sm text-muted leading-relaxed mb-4">
        A lightweight self-hosted ticket + chat platform for small teams who
        want feedback and support handled without the overhead of Zendesk or
        Intercom.
      </p>

      <div class="mb-4">
        <div class="eyebrow mb-2">Features</div>
        <ul class="text-sm space-y-1.5" style="list-style: none; padding: 0;">
          <li class="flex gap-2"><span class="text-fainter">•</span><span>Ticket inbox with real-time chat</span></li>
          <li class="flex gap-2"><span class="text-fainter">•</span><span>Email notifications + browser push</span></li>
          <li class="flex gap-2"><span class="text-fainter">•</span><span>Projects, groups, internal notes</span></li>
          <li class="flex gap-2"><span class="text-fainter">•</span><span>Installable PWA (iOS / Android / desktop)</span></li>
        </ul>
      </div>

      <div>
        <div class="eyebrow mb-2">Need access?</div>
        <p class="text-sm text-muted leading-relaxed">
          This is a private instance. Registration is invite-only —
          {#if supportEmail}
            contact
            <a href="mailto:{supportEmail}"
               class="font-medium"
               style="color: var(--color-accent); text-decoration: underline;">{supportEmail}</a>
            to request an account.
          {:else}
            contact your administrator to request an account.
          {/if}
        </p>
      </div>
    </div>
  </div>
{/if}
