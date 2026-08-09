<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Props = { theme: 'dark' | 'light' };
  const { theme }: Props = $props();

  let optimistic = $state<'dark' | 'light' | null>(null);
  let busy = $state(false);

  const effective = $derived(optimistic ?? theme);

  async function toggle() {
    if (busy) return;
    const next: 'dark' | 'light' = effective === 'dark' ? 'light' : 'dark';
    const prev = effective;
    busy = true;
    optimistic = next;
    document.documentElement.setAttribute('data-theme', next);

    try {
      const res = await fetch('/api/theme', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: next })
      });
      if (!res.ok) throw new Error('theme save failed');
      await invalidateAll();
    } catch {
      document.documentElement.setAttribute('data-theme', prev);
    } finally {
      optimistic = null;
      busy = false;
    }
  }
</script>

<button
  type="button"
  class="btn btn-ghost relative h-9 w-9 !p-0 overflow-hidden"
  aria-label={effective === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
  onclick={toggle}
  disabled={busy}
>
  {#key effective}
    <span
      class="absolute inset-0 flex items-center justify-center"
      in:scale={{ start: 0.4, duration: 320, easing: cubicOut, opacity: 0 }}
      out:scale={{ start: 0.4, duration: 220, opacity: 0 }}
    >
      {#if effective === 'dark'}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      {:else}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      {/if}
    </span>
  {/key}
</button>
