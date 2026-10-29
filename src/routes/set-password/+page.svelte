<script lang="ts">
  import { enhance } from '$app/forms';
  import { scale, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { MIN_PASSWORD_LENGTH } from '$lib/passwordPolicy';

  type Props = {
    data: { token: string; valid: boolean; email: string; purpose: 'welcome' | 'reset' | null };
    form?: { error?: string; expired?: boolean; token?: string } | null;
  };
  const { data, form }: Props = $props();

  let submitting = $state(false);
  let show = $state(false);
  const usable = $derived(data.valid && !form?.expired);
</script>

<svelte:head>
  <title>Choose your password</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="min-h-[78vh] flex items-center justify-center px-4 py-12">
  <div
    class="glass-strong w-full max-w-md p-7"
    in:scale={{ start: 0.96, duration: 420, easing: cubicOut, opacity: 0 }}
  >
    {#if usable}
      <header class="mb-6">
        <h1 class="text-lg font-bold tracking-tight">
          {data.purpose === 'welcome' ? 'Welcome! Choose your password' : 'Choose a new password'}
        </h1>
        <p class="text-sm text-muted mt-1.5">
          For <strong>{data.email}</strong>. Pick something you will remember: a few
          random words work well. You will use it the next time you sign in.
        </p>
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
        <input type="hidden" name="token" value={data.token} />
        <input type="email" name="username" autocomplete="username" value={data.email} readonly tabindex="-1" aria-hidden="true" class="sr-only" />

        <div>
          <label for="password" class="label block mb-1.5">New password</label>
          <input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autocomplete="new-password"
            minlength={MIN_PASSWORD_LENGTH}
            required
            class="input"
          />
          <p class="text-xs text-fainter mt-1.5">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>

        <div>
          <label for="confirm" class="label block mb-1.5">Confirm new password</label>
          <input
            id="confirm"
            name="confirm"
            type={show ? 'text' : 'password'}
            autocomplete="new-password"
            minlength={MIN_PASSWORD_LENGTH}
            required
            class="input"
          />
        </div>

        <label class="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" bind:checked={show} /> Show passwords
        </label>

        <button type="submit" class="btn btn-primary mt-1 h-11 w-full text-sm" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save password and sign in'}
        </button>
      </form>
    {:else}
      <header class="mb-4">
        <h1 class="text-lg font-bold tracking-tight">This link is no longer valid</h1>
        <p class="text-sm text-muted mt-1.5">
          It may have expired, already been used, or been replaced by a newer one.
          Request a fresh link and check your inbox.
        </p>
      </header>
      <a href="/forgot-password" class="btn btn-primary h-11 w-full text-sm flex items-center justify-center">
        Send me a new link
      </a>
      <a href="/login" class="block text-xs text-center mt-3" style="color: var(--color-accent);">
        Back to sign in
      </a>
    {/if}
  </div>
</main>
