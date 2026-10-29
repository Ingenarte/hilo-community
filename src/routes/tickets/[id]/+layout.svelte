<script lang="ts">
  import { page } from '$app/state';

  const { children }: { children: import('svelte').Snippet } = $props();
</script>

<!--
  Moving between tickets (previous / next, j / k, back) keeps the same route, so
  SvelteKit would reuse the page component and its onMount work (live stream,
  mark-as-read, scroll position, draft state) would stay on the old ticket.
  Keying on the id remounts the page for every ticket.
-->
{#key page.params.id}
  {@render children()}
{/key}
