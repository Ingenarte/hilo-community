<script lang="ts">
  /**
   * Reusable confirmation modal — the shared chassis behind LogoutButton,
   * ExportCsvButton, and any future confirm-then-do action.
   *
   * The component owns:
   *   - portal teleport to <body> (escapes header stacking context)
   *   - focus management (autofocus on Cancel = safer default)
   *   - escape + backdrop dismiss
   *   - hilo branding header
   *   - icon disk + title + description layout
   *   - action row with Cancel + confirmation
   *
   * Consumers pass `open={true}` to show the modal (use $bindable for
   * two-way binding) plus title/description/icon/variant/confirmLabel.
   *
   * For form-POST confirmations, set `formAction="/logout"` — the modal
   * wraps actions in a <form> and submits on confirm. For link-style
   * downloads, set `href="/api/admin/export.csv" download` instead.
   * For arbitrary JS handlers, pass `onConfirm`.
   */
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { tick, type Snippet } from 'svelte';

  type Variant = 'danger' | 'primary' | 'neutral';

  type Props = {
    open: boolean;
    title: string;
    description?: string;
    note?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: Variant;
    /** SvelteKit form action (POST). E.g. "/logout". */
    formAction?: string;
    /** Link href for download/navigation confirms. */
    href?: string;
    /** If `href` is set, whether the link triggers a browser download. */
    download?: boolean;
    /** JS callback for programmatic confirms. */
    onConfirm?: () => void | Promise<void>;
    icon?: Snippet;
  };

  let {
    open = $bindable(),
    title,
    description,
    note,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'primary',
    formAction,
    href,
    download = false,
    onConfirm,
    icon
  }: Props = $props();

  let cancelEl: HTMLButtonElement | null = $state(null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      }
    };
  }

  function cancel() {
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      cancel();
    }
  }

  async function handleClick() {
    if (onConfirm) {
      await onConfirm();
      open = false;
    } else if (href) {
      // Allow the browser to navigate / download; close after.
      open = false;
    }
  }

  $effect(() => {
    if (open) {
      tick().then(() => cancelEl?.focus());
    }
  });

  const confirmClass = $derived(
    variant === 'danger' ? 'btn btn-danger' : variant === 'primary' ? 'btn btn-primary' : 'btn'
  );

  const iconStyle = $derived(
    variant === 'danger'
      ? 'background: oklch(0.7 0.22 25 / 0.12); color: var(--color-danger);'
      : variant === 'primary'
        ? 'background: oklch(0.52 0.14 240 / 0.14); color: oklch(0.65 0.14 240);'
        : 'background: var(--glass-tint); color: var(--color-muted);'
  );
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div
    use:portal
    class="fixed inset-0 z-[200] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 10vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-title"
    aria-describedby={description ? 'confirm-desc' : undefined}
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/75 p-0"
      aria-label="Dismiss"
      tabindex="-1"
      onclick={cancel}
    ></button>

    {#snippet body()}
      <div class="flex items-center gap-1.5 mb-4 text-fainter">
        <img src="/favicon.svg" alt="" width="16" height="16" />
        <span class="text-xs font-semibold tracking-tight">hilo</span>
      </div>

      <div class="flex items-start gap-3 mb-4">
        {#if icon}
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={iconStyle}
            aria-hidden="true"
          >
            {@render icon()}
          </div>
        {/if}
        <div class="flex-1 min-w-0">
          <h2 id="confirm-title" class="text-base font-bold tracking-tight">{title}</h2>
          {#if description}
            <p id="confirm-desc" class="text-sm text-muted mt-0.5">{description}</p>
          {/if}
        </div>
      </div>

      {#if note}
        <p class="text-xs text-faint mb-5">{note}</p>
      {/if}

      <div class="flex items-center justify-end gap-2">
        <button type="button" class="btn" bind:this={cancelEl} onclick={cancel}>
          {cancelLabel}
        </button>
        {#if formAction}
          <form method="POST" action={formAction} style="display:inline">
            <button type="submit" class={confirmClass}>{confirmLabel}</button>
          </form>
        {:else if href}
          <a {href} {download} class={confirmClass} onclick={handleClick}>{confirmLabel}</a>
        {:else}
          <button type="button" class={confirmClass} onclick={handleClick}>{confirmLabel}</button>
        {/if}
      </div>
    {/snippet}

    <div
      class="glass-strong relative z-10 w-full max-w-sm p-6"
      in:fly={{ y: 8, duration: 280, easing: cubicOut }}
    >
      {@render body()}
    </div>
  </div>
{/if}
