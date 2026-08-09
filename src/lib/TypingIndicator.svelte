<script lang="ts">
  /**
   * "X is typing" pill with three breathing dots.
   *
   * Animation lives in `app.css` (`.typing-dot` keyframes). The component
   * itself is purely presentational — parent owns the typing state +
   * timer + SSE filtering (see `tickets/[id]/+page.svelte`).
   */
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Props = { email: string };
  const { email }: Props = $props();
</script>

<div
  class="glass-subtle inline-flex items-center gap-2 px-3 py-1.5 text-xs text-muted"
  in:fly={{ y: 4, duration: 180, easing: cubicOut }}
  out:fade={{ duration: 180 }}
>
  <span>{email} is typing</span>
  <span class="inline-flex gap-0.5">
    {#each [0, 0.15, 0.3] as d}
      <span class="typing-dot inline-block w-1 h-1 rounded-full"
            style="background: var(--color-accent); animation-delay: {d}s;"></span>
    {/each}
  </span>
</div>
