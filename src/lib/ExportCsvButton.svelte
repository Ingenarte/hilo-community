<script lang="ts">
  import Confirm from './Confirm.svelte';

  let open = $state(false);
</script>

<button type="button" class="btn" onclick={() => (open = true)}>
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
  Export CSV
</button>

{#snippet downloadIcon()}
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
{/snippet}

<Confirm
  bind:open
  variant="primary"
  title="Export all tickets?"
  description="A CSV with every ticket (titles, status, metadata) will be downloaded."
  note="Treat the file as confidential — it can contain user emails and message excerpts."
  confirmLabel="Download CSV"
  href="/api/admin/export.csv"
  download
  icon={downloadIcon}
/>
