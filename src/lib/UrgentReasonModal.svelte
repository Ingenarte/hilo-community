<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { tick } from 'svelte';
  import { SLA_HOURS, URGENT_REASON_MAX, URGENT_REASON_MIN } from '$lib/sla';

  type Props = {
    open: boolean;
    /** Prefill, e.g. when editing an existing reason. */
    initialReason?: string;
    /** Extra context line, e.g. "3 tickets selected". */
    context?: string;
    busy?: boolean;
    error?: string | null;
    onconfirm: (reason: string) => void;
    oncancel: () => void;
  };

  const { open, initialReason = '', context, busy = false, error = null, onconfirm, oncancel }: Props = $props();

  let reason = $state('');
  let area = $state<HTMLTextAreaElement | null>(null);

  const trimmedLength = $derived(reason.trim().length);
  const valid = $derived(trimmedLength >= URGENT_REASON_MIN && trimmedLength <= URGENT_REASON_MAX);

  // Fresh draft every time the modal opens.
  $effect(() => {
    if (open) {
      reason = initialReason;
      tick().then(() => area?.focus());
    }
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      oncancel();
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (valid && !busy) onconfirm(reason.trim());
  }
</script>

{#if open}
  <div
    use:portal
    class="fixed inset-0 z-[260] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 10vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="urgent-modal-title"
    tabindex="-1"
    onkeydown={onKeydown}
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/60 p-0"
      aria-label="Cancel"
      tabindex="-1"
      onclick={oncancel}
    ></button>

    <form
      class="glass relative z-10 w-full max-w-md p-6 rounded-xl"
      onsubmit={submit}
      transition:fly={{ y: 12, duration: 200, easing: cubicOut }}
    >
      <h2 id="urgent-modal-title" class="text-lg font-semibold mb-1" style="color: var(--color-danger);">
        Mark as urgent
      </h2>
      {#if context}
        <p class="text-xs text-fainter mb-2">{context}</p>
      {/if}
      <p class="text-sm text-muted mb-4">
        Urgent tickets are expected to be answered within
        <strong>{SLA_HOURS.urgent} hours</strong>. Tell us why this cannot wait.
      </p>

      <label class="flex flex-col gap-1.5 mb-1">
        <span class="text-sm text-muted">Reason (required)</span>
        <textarea
          bind:this={area}
          bind:value={reason}
          class="input"
          rows="3"
          maxlength={URGENT_REASON_MAX}
          placeholder="e.g. Production is down for all customers"
        ></textarea>
      </label>
      <div class="text-xs text-fainter mb-3 num text-right">
        {trimmedLength} / {URGENT_REASON_MAX}
        {#if trimmedLength < URGENT_REASON_MIN}
          · at least {URGENT_REASON_MIN}
        {/if}
      </div>

      {#if error}
        <p class="text-sm mb-3" style="color: var(--color-danger);">{error}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <button type="button" class="btn" onclick={oncancel} disabled={busy}>Cancel</button>
        <button
          type="submit"
          class="btn btn-primary"
          style="background: var(--color-danger); border-color: var(--color-danger);"
          disabled={!valid || busy}
        >
          {busy ? 'Saving…' : 'Confirm urgent'}
        </button>
      </div>
    </form>
  </div>
{/if}
