<script lang="ts">
  /**
   * Global error page. Used for 404 / 500 / any throw from a load function.
   *
   * Honours the glassmorphic brand and never leaks stack traces — SvelteKit
   * sanitises `$page.error` for production builds; in dev it includes the
   * full message which is fine because the dev panel exists.
   */
  import { page } from '$app/stores';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  const status = $derived($page.status);
  const isNotFound = $derived(status === 404);
  const isForbidden = $derived(status === 403);
  const isUnauthorized = $derived(status === 401);
  const isClientError = $derived(status >= 400 && status < 500);

  const title = $derived(
    isNotFound
      ? "We couldn't find that"
      : isForbidden
        ? "You don't have access to that"
        : isUnauthorized
          ? 'Please sign in to continue'
          : isClientError
            ? "That request couldn't be processed"
            : 'Something went wrong'
  );
  const subtitle = $derived(
    isNotFound
      ? 'The link might be old, or the ticket might have been deleted.'
      : isForbidden
        ? 'Your account doesn’t have permission to view this page. If you think that’s a mistake, ask an admin.'
        : isUnauthorized
          ? 'Your session expired or you were signed out. Sign in again to pick up where you left off.'
          : isClientError
            ? 'The page or action you were trying to reach didn’t work. Double-check the link or go back to your inbox.'
            : "It's not you — the server hit a snag. Try again in a moment."
  );
  const primaryHref = $derived(isUnauthorized ? '/login' : '/tickets');
  const primaryLabel = $derived(isUnauthorized ? 'Sign in' : 'Back to inbox');
</script>

<svelte:head>
  <title>{$page.status} · hilo</title>
</svelte:head>

<section class="min-h-[60vh] flex items-center justify-center px-6">
  <div
    class="glass-strong max-w-md w-full p-8 text-center"
    in:fly={{ y: 8, duration: 320, easing: cubicOut }}
  >
    <div class="eyebrow mb-3" style="color: var(--color-accent)">
      Error {$page.status}
    </div>
    <h1 class="text-2xl font-bold tracking-tight mb-2">{title}</h1>
    <p class="text-muted text-sm mb-6">{subtitle}</p>

    {#if $page.error?.message && import.meta.env.DEV}
      <pre
        class="md-fence text-left text-xs mb-6 whitespace-pre-wrap break-words"
      >{$page.error.message}</pre>
    {/if}

    <div class="flex items-center justify-center gap-2">
      <a href={primaryHref} class="btn btn-primary">{primaryLabel}</a>
      {#if !isClientError}
        <button
          type="button"
          class="btn"
          onclick={() => window.location.reload()}
        >Retry</button>
      {/if}
    </div>
  </div>
</section>
