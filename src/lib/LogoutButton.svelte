<script lang="ts">
  import Confirm from './Confirm.svelte';

  /** `icon`: square ghost button. `menu`: full-width row for a dropdown. */
  type Props = { email: string; variant?: 'icon' | 'menu' };
  const { email, variant = 'icon' }: Props = $props();

  let open = $state(false);
</script>

{#if variant === 'menu'}
  <button
    type="button"
    class="menu-item"
    role="menuitem"
    data-testid="menu-sign-out"
    onclick={() => (open = true)}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
    Sign out
  </button>
{:else}
  <button
    type="button"
    class="btn btn-ghost btn-sm btn-icon"
    aria-label="Sign out"
    title="Sign out"
    onclick={() => (open = true)}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  </button>
{/if}

{#snippet logoutIcon()}
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <polyline points="10 17 15 12 10 7" />
    <line x1="15" y1="12" x2="3" y2="12" />
  </svg>
{/snippet}

<Confirm
  bind:open
  variant="danger"
  title="Sign out?"
  description={`Signed in as ${email}`}
  note="You'll need to enter your access code again to come back."
  confirmLabel="Sign out"
  formAction="/logout"
  icon={logoutIcon}
/>
