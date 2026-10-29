<script lang="ts">
  import { enhance } from '$app/forms';
  import { scale, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Props = {
    form?: { ok?: boolean; error?: string; email?: string } | null;
  };

  const { form }: Props = $props();

  let submitting = $state(false);
</script>

<main class="min-h-[78vh] flex items-center justify-center px-4 py-12">
  <div
    class="glass-strong w-full max-w-md p-7"
    in:scale={{ start: 0.96, duration: 420, easing: cubicOut, opacity: 0 }}
  >
    <header class="mb-6">
      <h1 class="text-lg font-bold tracking-tight">Reset your password</h1>
      <p class="text-sm text-muted mt-1.5">
        Enter your account email. If it exists, we'll send a link to choose a new password.
      </p>
    </header>

    {#if form?.ok}
      <div class="mb-4 rounded-xl px-3 py-2.5 text-sm" role="status">
        If an account exists for that email, a link to choose a new password is on its way.
        It works once and expires in 1 hour. Check your inbox.
      </div>
      <a href="/login" class="btn btn-primary mt-2 h-11 w-full text-sm flex items-center justify-center">
        Back to sign in
      </a>
    {:else}
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
            id="email"
            name="email"
            type="email"
            autocomplete="email"
            required
            class="input"
            value={form?.email ?? ''}
          />
        </div>

        <button type="submit" class="btn btn-primary mt-2 h-11 w-full text-sm" disabled={submitting}>
          {submitting ? 'Sending…' : 'Email me a link'}
        </button>

        <a href="/login" class="text-xs text-center" style="color: var(--color-accent);">
          Back to sign in
        </a>
      </form>
    {/if}
  </div>
</main>
