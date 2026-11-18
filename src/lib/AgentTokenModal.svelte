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
    /**
     * Lifetimes (days) the user may pick. More than one entry shows the admin-only
     * "Expires in" selector; the first entry is the default (4 days = 96 hours).
     */
    ttlChoices?: number[];
  };

  const { open, ticketId = null, onclose, oncreated, ttlChoices = [4] }: Props = $props();

  const ttlLabel = (days: number) => (days === 4 ? '96 hours (default)' : days === 365 ? '1 year' : `${days} days`);

  type Created = {
    token: string;
    info: {
      id: number;
      expires_at: number;
      can_reply: boolean;
      can_create: boolean;
      project_id: number | null;
      ticket_id: number | null;
    };
  };

  let canReply = $state(true);
  let canCreate = $state(false);
  let ttlDays = $state(4);
  /** '' = any of my projects. */
  let createProjectId = $state('');
  let projects = $state<Array<{ id: number; name: string; slug: string }>>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let created = $state<Created | null>(null);
  let copied = $state<'token' | 'brief' | null>(null);

  $effect(() => {
    if (open) {
      canReply = true;
      canCreate = false;
      ttlDays = ttlChoices[0] ?? 4;
      createProjectId = '';
      busy = false;
      error = null;
      created = null;
      copied = null;
    }
  });

  // Projects for the optional "open tickets only in" restriction.
  $effect(() => {
    if (open && canCreate && projects.length === 0) {
      fetch('/api/projects')
        .then((r) => (r.ok ? r.json() : { projects: [] }))
        .then((d) => (projects = d.projects ?? []))
        .catch(() => {});
    }
  });

  const brief = $derived(
    created
      ? buildAgentBrief({
          baseUrl: typeof location === 'undefined' ? '' : location.origin,
          token: created.token,
          ticketId: created.info.ticket_id,
          canReply: created.info.can_reply,
          canCreate: created.info.can_create,
          projectId: created.info.project_id,
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
        body: JSON.stringify({
          ticketId,
          canReply,
          ...(ttlChoices.length > 1 && ttlDays !== 4 ? { ttlDays } : {}),
          ...(ticketId == null && canCreate
            ? { canCreate: true, projectId: createProjectId ? Number(createProjectId) : null }
            : {})
        })
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
          It stops working <strong>{ttlDays === 4 ? '96 hours' : ttlLabel(ttlDays)}</strong> after
          you create it, and you can revoke it at any time.
        </p>

        <label class="flex items-start gap-2.5 mb-4 cursor-pointer select-none">
          <input type="checkbox" class="h-5 w-5 mt-0.5" bind:checked={canReply} />
          <span class="text-sm">
            Allow the agent to reply (short messages, marked as written by an agent) and change
            the ticket status
            <span class="block text-xs text-fainter">Untick for a read-only token.</span>
          </span>
        </label>

        {#if ticketId == null}
          <label class="flex items-start gap-2.5 mb-3 cursor-pointer select-none">
            <input
              type="checkbox"
              class="h-5 w-5 mt-0.5"
              data-testid="token-can-create"
              bind:checked={canCreate}
            />
            <span class="text-sm">
              Allow the agent to open new tickets
              <span class="block text-xs text-fainter">
                Tickets are opened in your name. If you are not an admin they wait for admin
                approval.
              </span>
            </span>
          </label>
          {#if canCreate}
            <div class="mb-4 ml-7">
              <label class="label block mb-1.5" for="agent-token-project">Open tickets only in</label>
              <select
                id="agent-token-project"
                class="input"
                data-testid="token-project"
                bind:value={createProjectId}
              >
                <option value="">Any of my projects</option>
                {#each projects as p (p.id)}
                  <option value={String(p.id)}>{p.name}</option>
                {/each}
              </select>
            </div>
          {/if}
        {/if}

        {#if ttlChoices.length > 1}
          <div class="mb-4">
            <label class="label block mb-1.5" for="agent-token-ttl">Expires in</label>
            <select id="agent-token-ttl" class="input" data-testid="token-ttl" bind:value={ttlDays}>
              {#each ttlChoices as d (d)}
                <option value={d}>{ttlLabel(d)}</option>
              {/each}
            </select>
            {#if ttlDays > 4}
              <span class="block text-xs text-fainter mt-1">
                Long-lived token for server-to-server integrations. Store it like a password and
                revoke it when the integration is retired.
              </span>
            {/if}
          </div>
        {/if}

        {#if error}
          <p class="text-sm mb-3" style="color: var(--color-danger);" role="alert">{error}</p>
        {/if}

        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onclick={onclose} disabled={busy}>Cancel</button>
          <button type="button" class="btn btn-primary" onclick={generate} disabled={busy}>
            {busy ? 'Generating…' : `Generate token (${ttlDays === 4 ? '96 h' : ttlLabel(ttlDays)})`}
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
          {#if created.info.can_create}
            · can open tickets{created.info.project_id != null
              ? ` in ${projects.find((p) => p.id === created!.info.project_id)?.name ?? `project ${created.info.project_id}`}`
              : ''}
          {/if}
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
