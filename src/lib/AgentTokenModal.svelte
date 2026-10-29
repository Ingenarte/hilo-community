<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { buildAgentBrief } from '$lib/agentBrief';

  type Props = {
    open: boolean;
    /** Limit the token to one ticket. Omit for a token covering all my tickets. */
    ticketId?: number | null;
    onclose: () => void;
    /** Called after a token was created (e.g. to refresh a list). */
    oncreated?: () => void;
  };

  const { open, ticketId = null, onclose, oncreated }: Props = $props();

  type Created = {
    token: string;
    info: { id: number; expires_at: number; can_reply: boolean; ticket_id: number | null };
  };

  let canReply = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let created = $state<Created | null>(null);
  let copied = $state<'token' | 'brief' | null>(null);

  $effect(() => {
    if (open) {
      canReply = true;
      busy = false;
      error = null;
      created = null;
      copied = null;
    }
  });

  const brief = $derived(
    created
      ? buildAgentBrief({
          baseUrl: typeof location === 'undefined' ? '' : location.origin,
          token: created.token,
          ticketId: created.info.ticket_id,
          canReply: created.info.can_reply,
          expiresAt: created.info.expires_at
        })
      : ''
  );

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  async function generate() {
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, canReply })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = body.message || body.error || 'Could not create the token.';
        return;
      }
      created = await res.json();
      oncreated?.();
    } catch {
      error = 'Network error. Try again.';
    } finally {
      busy = false;
    }
  }

  async function copy(text: string, what: 'token' | 'brief') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copied = what;
    setTimeout(() => (copied = null), 1800);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
</script>

{#if open}
  <div
    use:portal
    class="fixed inset-0 z-[260] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 8vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="agent-token-title"
    tabindex="-1"
    onkeydown={onKeydown}
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/60 p-0"
      aria-label="Close"
      tabindex="-1"
      onclick={onclose}
    ></button>

    <div
      class="glass relative z-10 w-full max-w-lg p-6 rounded-xl"
      transition:fly={{ y: 12, duration: 200, easing: cubicOut }}
    >
      <h2 id="agent-token-title" class="text-lg font-semibold mb-1">Agent token</h2>

      {#if !created}
        <p class="text-sm text-muted mb-4">
          {#if ticketId != null}
            Creates a token for ticket <strong>#{ticketId}</strong> only. Hand it to a coding
            agent so it can read the ticket (text, images and audio) and write back.
          {:else}
            Creates a token for every ticket you can see. Hand it to a coding agent so it can
            list and read tickets and write back.
          {/if}
          It stops working <strong>96 hours</strong> after you create it, and you can revoke it
          at any time.
        </p>

        <label class="flex items-start gap-2.5 mb-4 cursor-pointer select-none">
          <input type="checkbox" class="h-5 w-5 mt-0.5" bind:checked={canReply} />
          <span class="text-sm">
            Allow the agent to reply (short messages, marked as written by an agent) and change
            the ticket status
            <span class="block text-xs text-fainter">Untick for a read-only token.</span>
          </span>
        </label>

        {#if error}
          <p class="text-sm mb-3" style="color: var(--color-danger);" role="alert">{error}</p>
        {/if}

        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onclick={onclose} disabled={busy}>Cancel</button>
          <button type="button" class="btn btn-primary" onclick={generate} disabled={busy}>
            {busy ? 'Generating…' : 'Generate token (96 h)'}
          </button>
        </div>
      {:else}
        <p class="text-sm mb-3" style="color: var(--color-danger);">
          Copy it now: this is the only time the token is shown.
        </p>

        <label class="label block mb-1.5" for="agent-token-value">Token</label>
        <div class="flex gap-2 mb-1">
          <input
            id="agent-token-value"
            class="input font-mono text-xs flex-1"
            readonly
            value={created.token}
            onfocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <button type="button" class="btn" onclick={() => copy(created!.token, 'token')}>
            {copied === 'token' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p class="text-xs text-fainter mb-4" data-testid="token-expiry">
          Expires {new Date(created.info.expires_at * 1000).toLocaleString()}
          · {created.info.can_reply ? 'can reply and change status' : 'read-only'}
        </p>

        <label class="label block mb-1.5" for="agent-brief">Instructions for the agent</label>
        <textarea
          id="agent-brief"
          class="textarea font-mono text-xs"
          rows="7"
          readonly
          value={brief}
        ></textarea>

        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn" onclick={() => copy(brief, 'brief')}>
            {copied === 'brief' ? 'Copied' : 'Copy token + instructions'}
          </button>
          <button type="button" class="btn btn-primary" onclick={onclose}>Done</button>
        </div>
      {/if}
    </div>
  </div>
{/if}
