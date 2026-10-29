<script lang="ts">
  import { enhance } from '$app/forms';
  import { scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Props = { data: { recipient: string; signedInAs: string | null; isTicket: boolean } };
  const { data }: Props = $props();
  let busy = $state(false);
</script>

<svelte:head>
  <title>Open your conversation</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="min-h-[78vh] flex items-center justify-center px-4 py-12">
  <div class="glass-strong w-full max-w-md p-7" in:scale={{ start: 0.96, duration: 420, easing: cubicOut, opacity: 0 }}>
    <header class="mb-5">
      <h1 class="text-lg font-bold tracking-tight">
        {data.isTicket ? 'Open your conversation' : 'Open Hilo'}
      </h1>
      <p class="text-sm text-muted mt-1.5">
        This link was sent to <strong>{data.recipient}</strong>. Tap the button to continue,
        no password needed.
      </p>
      {#if data.signedInAs}
        <p class="text-xs mt-2" style="color: var(--color-warn);" data-testid="magic-switch-note">
          You are signed in as {data.signedInAs}. Continuing switches to {data.recipient}.
        </p>
      {/if}
    </header>

    <form
      method="POST"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          await update();
          busy = false;
        };
      }}
    >
      <button type="submit" class="btn btn-primary h-11 w-full text-sm" disabled={busy} data-testid="magic-continue">
        {busy ? 'Opening…' : data.isTicket ? 'Open the conversation' : 'Continue'}
      </button>
    </form>

    <a href="/login" class="block text-xs text-center mt-4" style="color: var(--color-accent);">
      Sign in with a password instead
    </a>
  </div>
</main>
