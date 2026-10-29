<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { tick } from 'svelte';
  import UrgentReasonModal from '$lib/UrgentReasonModal.svelte';
  import ExtendTimeModal from '$lib/ExtendTimeModal.svelte';

  type Priority = 'urgent' | 'high' | 'normal' | 'low';

  type Props = {
    /** Selected ticket ids. The bar only shows while there is at least one. */
    ids: number[];
    /** The Queue lists open tickets only, so Reopen and Archive are hidden there. */
    mode?: 'inbox' | 'queue';
    /** Inbox showing archived tickets: offer Restore instead of Archive. */
    archivedView?: boolean;
    /** Called after a successful action with a short summary; the parent clears the selection and refreshes. */
    ondone: (info: { message: string }) => void;
    onclear: () => void;
  };

  const { ids, mode = 'inbox', archivedView = false, ondone, onclear }: Props = $props();

  let bulkPriority = $state<Priority>('normal');
  let busy = $state(false);
  let actionError = $state<string | null>(null);

  let urgentOpen = $state(false);
  let urgentError = $state<string | null>(null);
  let extendOpen = $state(false);
  let extendError = $state<string | null>(null);

  const count = $derived(ids.length);
  const countText = $derived(`${count} ticket${count === 1 ? '' : 's'}`);

  // Teleport to <body> so ancestors with transform/backdrop-filter cannot
  // become the containing block of the fixed dock.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  type Op = 'close' | 'reopen' | 'priority' | 'archive' | 'unarchive' | 'extend';
  type Extra = { reason?: string; hours?: number; urgent?: boolean };

  async function run(op: Op, extra: Extra = {}): Promise<string | null> {
    if (!count || busy) return 'Nothing selected.';
    busy = true;
    try {
      const res = await fetch('/api/admin/tickets/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ids,
          op,
          priority: op === 'priority' ? bulkPriority : undefined,
          hours: extra.hours,
          reason: extra.reason,
          confirmUrgent: extra.urgent ? '1' : undefined
        })
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; affected?: number; skipped?: number };
      if (!res.ok) return body.error ?? 'The action failed. Please try again.';
      const n = body.affected ?? count;
      const verb: Record<Op, string> = {
        close: 'closed',
        reopen: 'reopened',
        priority: `set to ${bulkPriority}`,
        archive: 'archived',
        unarchive: 'restored',
        extend: 'extended'
      };
      let message = `${n} ticket${n === 1 ? '' : 's'} ${verb[op]}.`;
      if (op === 'extend' && body.skipped) {
        message += ` ${body.skipped} skipped (closed or without a response time).`;
      }
      ondone({ message });
      return null;
    } catch {
      return 'The action failed. Please try again.';
    } finally {
      busy = false;
    }
  }

  async function simple(op: Op) {
    actionError = null;
    const err = await run(op);
    if (err) actionError = err;
  }

  async function applyPriority() {
    actionError = null;
    // Urgent needs a written reason plus a confirmation: collect it first.
    if (bulkPriority === 'urgent') {
      urgentError = null;
      urgentOpen = true;
      return;
    }
    const err = await run('priority');
    if (err) actionError = err;
  }

  async function confirmUrgent(reason: string) {
    const err = await run('priority', { reason, urgent: true });
    if (err) urgentError = err;
    else urgentOpen = false;
  }

  async function confirmExtend(hours: number, reason: string) {
    const err = await run('extend', { hours, reason });
    if (err) extendError = err;
    else extendOpen = false;
  }

  // Export: a hidden native form POST so the browser streams the download.
  let exportForm = $state<HTMLFormElement | null>(null);
  let exportFormat = $state('md');
  async function exportAs(format: string) {
    if (!count) return;
    exportFormat = format;
    await tick();
    exportForm?.requestSubmit();
  }
</script>

{#if count > 0}
  <!--
    Docked to the bottom of the viewport and portaled to <body> so showing or
    hiding it never moves the list under the pointer.
  -->
  <div
    use:portal
    class="fixed inset-x-0 z-[255] flex justify-center px-3 pointer-events-none"
    style="bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));"
    role="toolbar"
    aria-label="Actions for selected tickets"
    data-testid="bulk-bar"
    in:fly={{ y: 16, duration: 160, easing: cubicOut }}
    out:fade={{ duration: 100 }}
  >
    <div class="glass-strong pointer-events-auto max-w-full sm:max-w-[1200px] px-3 sm:px-3.5 py-2 flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-1.5">
      <span class="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md text-[11px] font-bold num"
            style="background: var(--color-accent); color: var(--color-on-accent);">
        {count}
      </span>
      <span class="text-sm font-semibold">selected</span>

      <span class="h-4 w-px hidden sm:block" style="background: var(--glass-border);"></span>

      <button type="button" class="btn btn-sm" disabled={busy} onclick={() => simple('close')} data-testid="bulk-close">Close</button>
      {#if mode === 'inbox'}
        <button type="button" class="btn btn-sm" disabled={busy} onclick={() => simple('reopen')}>Reopen</button>
        {#if archivedView}
          <button type="button" class="btn btn-sm" disabled={busy} onclick={() => simple('unarchive')}>Restore</button>
        {:else}
          <button type="button" class="btn btn-sm" disabled={busy} onclick={() => simple('archive')}>Archive</button>
        {/if}
      {/if}
      <button type="button" class="btn btn-sm" disabled={busy}
              onclick={() => { extendError = null; extendOpen = true; }} data-testid="bulk-extend">Extend time</button>

      <span class="h-4 w-px hidden sm:block" style="background: var(--glass-border);"></span>

      <span class="text-fainter text-xs hidden sm:inline">Set priority</span>
      <select class="select select-sm w-auto" aria-label="Priority to set" bind:value={bulkPriority}>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="normal">Normal</option>
        <option value="low">Low</option>
      </select>
      <button type="button" class="btn btn-sm" disabled={busy} onclick={applyPriority} data-testid="bulk-priority">Apply</button>

      <span class="ml-auto"></span>
      <span class="text-fainter text-xs inline-flex items-center gap-1" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span class="hidden sm:inline">Export as</span>
      </span>
      {#each ['md', 'pdf', 'docx'] as f}
        <button
          type="button"
          class="btn btn-sm"
          title={f === 'md' ? 'Markdown (ZIP with images and audio)' : f === 'pdf' ? 'One PDF with all selected tickets' : 'One Word document with all selected tickets'}
          aria-label={`Export selected tickets as ${f.toUpperCase()}`}
          onclick={() => exportAs(f)}
        >{f.toUpperCase()}</button>
      {/each}
      <span class="h-4 w-px hidden sm:block" style="background: var(--glass-border);"></span>
      <button type="button" class="btn btn-ghost btn-sm" onclick={onclear} data-testid="bulk-clear">Clear</button>

      {#if actionError}
        <p class="basis-full text-xs" style="color: var(--color-danger);" role="alert" data-testid="bulk-error">{actionError}</p>
      {/if}
    </div>
  </div>
{/if}

<form bind:this={exportForm} method="POST" action="/api/tickets/export" class="hidden">
  <input type="hidden" name="ids" value={ids.join(',')} />
  <input type="hidden" name="format" value={exportFormat} />
</form>

<UrgentReasonModal
  open={urgentOpen}
  context={countText + ' selected'}
  busy={busy}
  error={urgentError}
  onconfirm={confirmUrgent}
  oncancel={() => (urgentOpen = false)}
/>

<ExtendTimeModal
  open={extendOpen}
  context={countText + ' selected'}
  busy={busy}
  error={extendError}
  onconfirm={confirmExtend}
  oncancel={() => (extendOpen = false)}
/>
