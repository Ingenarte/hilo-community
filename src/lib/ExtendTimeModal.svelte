<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { tick } from 'svelte';
  import { EXTEND_HOUR_CHOICES, EXTEND_REASON_MAX, EXTEND_REASON_MIN } from '$lib/sla';

  type Props = {
    open: boolean;
    /** Current time left, shown as context ("2d 3h left" / "Overdue 5h"). */
    remaining?: string;
    /** Bulk use: e.g. "3 tickets selected", replaces the single-ticket wording. */
    context?: string;
    busy?: boolean;
    error?: string | null;
    onconfirm: (hours: number, reason: string) => void;
    oncancel: () => void;
  };

  const { open, remaining, context, busy = false, error = null, onconfirm, oncancel }: Props = $props();

  let reason = $state('');
  let hours = $state<number>(24);
  let area = $state<HTMLTextAreaElement | null>(null);

  const trimmedLength = $derived(reason.trim().length);
  const valid = $derived(trimmedLength >= EXTEND_REASON_MIN && trimmedLength <= EXTEND_REASON_MAX);

  // Fresh draft every time the modal opens.
  $effect(() => {
    if (open) {
      reason = '';
      hours = 24;
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
    if (valid && !busy) onconfirm(hours, reason.trim());
  }
</script>

{#if open}
  <div
    use:portal
    class="fixed left-0 right-0 top-0 z-[260] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="height: var(--vv-h, 100dvh); padding-top: min(10vh, 4rem);"
    role="dialog"
    aria-modal="true"
    aria-labelledby="extend-modal-title"
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
      data-testid="extend-modal"
    >
      <h2 id="extend-modal-title" class="text-lg font-semibold mb-1">Extend time</h2>
      {#if context}
        <p class="text-xs text-fainter mb-2">{context}</p>
      {:else if remaining}
        <p class="text-xs text-fainter mb-2">Right now: {remaining}</p>
      {/if}
      <p class="text-sm text-muted mb-4">
        {#if context}
          Add time to the response target of every selected ticket that is open and has one.
          Everyone on each ticket sees the reason.
        {:else}
          Add time to this ticket's response target. Everyone on the ticket sees the reason.
        {/if}
        A new message restarts the clock as usual.
      </p>

      <fieldset class="mb-3">
        <legend class="text-sm text-muted mb-1.5">Add</legend>
        <div class="flex gap-2">
          {#each EXTEND_HOUR_CHOICES as h (h)}
            <label class="chip cursor-pointer select-none justify-center" style="gap:6px; height: 40px; padding: 0 16px; flex: 1;">
              <input type="radio" name="extend-hours" value={h} checked={hours === h}
                     onchange={() => (hours = h)} />
              +{h} h
            </label>
          {/each}
        </div>
      </fieldset>

      <label class="flex flex-col gap-1.5 mb-1">
        <span class="text-sm text-muted">Reason (required)</span>
        <textarea
          bind:this={area}
          bind:value={reason}
          class="input"
          rows="3"
          maxlength={EXTEND_REASON_MAX}
          placeholder="e.g. Waiting for the client's access credentials"
          data-testid="extend-reason"
        ></textarea>
      </label>
      <div class="text-xs text-fainter mb-3 num text-right">
        {trimmedLength} / {EXTEND_REASON_MAX}
        {#if trimmedLength < EXTEND_REASON_MIN}
          · at least {EXTEND_REASON_MIN}
        {/if}
      </div>

      {#if error}
        <p class="text-sm mb-3" style="color: var(--color-danger);" role="alert">{error}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <button type="button" class="btn" onclick={oncancel} disabled={busy}>Cancel</button>
        <button type="submit" class="btn btn-primary" disabled={!valid || busy} data-testid="extend-confirm">
          {busy ? 'Saving…' : `Extend by ${hours} h`}
        </button>
      </div>
    </form>
  </div>
{/if}
