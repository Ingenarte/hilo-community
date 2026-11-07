<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { tick } from 'svelte';

  type Project = { id: number; name: string; status?: string };

  type Props = {
    open: boolean;
    ticketId: number;
    /** Projects currently tagged on the ticket. */
    projects: Project[];
    /** Whole catalogue (admin only). */
    allProjects: Project[];
    oncancel: () => void;
    /** Called after any change so the page can reload its data. */
    ondone: () => void | Promise<void>;
  };

  const { open, ticketId, projects, allProjects, oncancel, ondone }: Props = $props();

  let names = $state<Record<number, string>>({});
  let draft = $state<number[]>([]);
  let busy = $state(false);
  let panel = $state<HTMLDivElement | null>(null);
  let error = $state<string | null>(null);

  // Projects an admin can move the ticket to: active ones plus those already on the ticket.
  const choices = $derived(
    allProjects.filter((p) => p.status === 'active' || projects.some((c) => c.id === p.id))
  );

  $effect(() => {
    if (open) {
      names = Object.fromEntries(projects.map((p) => [p.id, p.name]));
      draft = projects.map((p) => p.id);
      error = null;
      // Move focus into the dialog so Escape and Tab work straight after the click.
      tick().then(() => panel?.focus());
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

  async function call(url: string, method: string, body: unknown, fallback: string) {
    busy = true;
    error = null;
    const r = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    busy = false;
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      error = b.error || b.message || fallback;
      return false;
    }
    return true;
  }

  async function rename(p: Project) {
    const name = (names[p.id] ?? '').trim();
    if (!name || name === p.name) return;
    if (await call('/api/admin/projects', 'PATCH', { id: p.id, name }, 'Failed to rename')) {
      await ondone();
    }
  }

  async function approve(p: Project) {
    if (await call('/api/admin/projects', 'PATCH', { id: p.id, status: 'active' }, 'Failed to approve')) {
      await ondone();
    }
  }

  function toggle(id: number) {
    draft = draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id];
  }

  const changed = $derived(
    draft.length !== projects.length || draft.some((id) => !projects.some((p) => p.id === id))
  );

  async function saveAssignment() {
    if (await call(`/api/tickets/${ticketId}/projects`, 'POST', { projectIds: draft }, 'Failed to save')) {
      await ondone();
      oncancel();
    }
  }
</script>

{#if open}
  <div
    use:portal
    class="fixed left-0 right-0 top-0 z-[260] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="height: var(--vv-h, 100dvh); padding-top: min(10vh, 4rem);"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ticket-project-title"
    tabindex="-1"
    onkeydown={onKeydown}
    transition:fade={{ duration: 160 }}
  >
    <button type="button" class="absolute inset-0 cursor-default border-0 bg-black/60 p-0"
            aria-label="Close" tabindex="-1" onclick={oncancel}></button>

    <div bind:this={panel} tabindex="-1" class="glass relative z-10 w-full max-w-md p-6 rounded-xl outline-none"
         transition:fly={{ y: 12, duration: 200, easing: cubicOut }}
         data-testid="ticket-project-modal">
      <h2 id="ticket-project-title" class="text-lg font-semibold mb-4">Project</h2>

      <section class="mb-5">
        <h3 class="text-sm text-muted mb-2">Rename or approve</h3>
        <p class="text-xs text-fainter mb-2">
          A new name applies to every ticket that uses the project.
        </p>
        {#each projects as p (p.id)}
          <div class="mb-2">
            <div class="flex items-center gap-2">
              <input class="input h-9 text-sm flex-1 min-w-0" maxlength="80"
                     aria-label="Project name" bind:value={names[p.id]}
                     data-testid="tp-name-{p.id}" />
              <button type="button" class="btn h-9 text-xs"
                      disabled={busy || !(names[p.id] ?? '').trim() || (names[p.id] ?? '').trim() === p.name}
                      onclick={() => rename(p)} data-testid="tp-rename-{p.id}">Rename</button>
            </div>
            {#if p.status === 'pending'}
              <div class="flex items-center gap-2 mt-1.5">
                <span class="chip" data-testid="tp-pending-{p.id}">Pending approval</span>
                <button type="button" class="btn btn-primary h-9 text-xs" disabled={busy}
                        onclick={() => approve(p)} data-testid="tp-approve-{p.id}">Approve as is</button>
              </div>
            {/if}
          </div>
        {/each}
        {#if projects.length === 0}
          <p class="text-xs text-fainter">This ticket has no project yet.</p>
        {/if}
      </section>

      <section class="mb-4">
        <h3 class="text-sm text-muted mb-2">Reassign this ticket</h3>
        <div class="flex flex-wrap gap-1.5 mb-3">
          {#each choices as p (p.id)}
            {@const active = draft.includes(p.id)}
            <button type="button" class="chip max-sm:min-h-9 max-sm:px-3" aria-pressed={active}
                    style={active ? 'background: var(--color-accent); color: var(--color-on-accent); border-color: transparent;' : ''}
                    onclick={() => toggle(p.id)} data-testid="tp-choice-{p.id}">
              {p.name}{p.status === 'pending' ? ' (pending)' : ''}
            </button>
          {/each}
        </div>
        <p class="text-xs text-fainter">
          Only this ticket changes. A pending project left with no tickets is removed.
        </p>
      </section>

      {#if error}
        <p class="text-sm mb-3" style="color: var(--color-danger);" data-testid="tp-error">{error}</p>
      {/if}
      <div class="flex justify-end gap-2">
        <button type="button" class="btn" onclick={oncancel}>Close</button>
        <button type="button" class="btn btn-primary" disabled={busy || !changed}
                onclick={saveAssignment} data-testid="tp-save">Save assignment</button>
      </div>
    </div>
  </div>
{/if}
