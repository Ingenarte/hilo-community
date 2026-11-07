<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Project = {
    id: number;
    name: string;
    slug: string;
    status: 'active' | 'archived';
    created_at: number;
    ticket_count: number;
  };

  type PendingProject = {
    id: number;
    name: string;
    slug: string;
    created_at: number;
    requested_by: { id: number; email: string } | null;
    tickets: Array<{ id: number; title: string }>;
  };
  type Props = {
    data: {
      projects: Project[];
      pending: PendingProject[];
      targets: Array<{ id: number; name: string }>;
    };
  };
  const { data }: Props = $props();

  let q = $state('');
  let filtered = $derived(
    q.trim()
      ? data.projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.slug.toLowerCase().includes(q.toLowerCase())
        )
      : data.projects
  );

  // ── New project modal ─────────────────────────────────────────────────────
  let showCreateModal = $state(false);
  let newName = $state('');
  let creating = $state(false);
  let createError = $state<string | null>(null);

  function autoSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || '';
  }

  let previewSlug = $derived(autoSlug(newName));

  async function onCreate(e: SubmitEvent) {
    e.preventDefault();
    creating = true;
    createError = null;
    const r = await fetch('/api/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    creating = false;
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      createError = body.error || body.message || 'Failed to create project';
      return;
    }
    showCreateModal = false;
    newName = '';
    await invalidateAll();
  }

  // ── Rename (inline per card) ──────────────────────────────────────────────
  let renamingId = $state<number | null>(null);
  let renameValue = $state('');
  let renameError = $state<string | null>(null);
  let renameSaving = $state(false);

  function startRename(p: Project) {
    renamingId = p.id;
    renameValue = p.name;
    renameError = null;
  }

  function cancelRename() {
    renamingId = null;
    renameError = null;
  }

  async function saveRename() {
    if (!renamingId) return;
    renameSaving = true;
    renameError = null;
    const r = await fetch('/api/admin/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: renamingId, name: renameValue })
    });
    renameSaving = false;
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      renameError = body.error || body.message || 'Failed to rename';
      return;
    }
    renamingId = null;
    await invalidateAll();
  }

  // ── Pending requests (users who used "+ Add" on a new ticket) ─────────────
  let pendingBusy = $state<number | null>(null);
  let pendingError = $state<string | null>(null);
  let pendingName = $state<Record<number, string>>({});
  let moveTarget = $state<Record<number, string>>({});

  async function pendingCall(id: number, url: string, method: string, body: unknown) {
    pendingBusy = id;
    pendingError = null;
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    pendingBusy = null;
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      pendingError = b.error || b.message || 'Request failed';
      return;
    }
    await invalidateAll();
  }

  const approve = (p: PendingProject) =>
    pendingCall(p.id, '/api/admin/projects', 'PATCH', { id: p.id, status: 'active' });

  // Rename first when the admin edited the name, then approve.
  async function renameAndApprove(p: PendingProject) {
    const name = (pendingName[p.id] ?? p.name).trim();
    if (name && name !== p.name) {
      const r = await fetch('/api/admin/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, name })
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        pendingError = b.error || 'Failed to rename';
        return;
      }
    }
    await approve(p);
  }

  const moveTickets = (p: PendingProject) =>
    pendingCall(p.id, '/api/admin/projects/merge', 'POST', {
      fromId: p.id,
      intoId: Number(moveTarget[p.id])
    });

  // ── Archive / unarchive ───────────────────────────────────────────────────
  let archiving = $state<number | null>(null);

  async function toggleArchive(p: Project) {
    const next = p.status === 'archived' ? 'active' : 'archived';
    if (
      next === 'archived' &&
      !confirm(`Archive "${p.name}"? Tickets won't be deleted — they just won't appear in new ticket creation.`)
    )
      return;
    archiving = p.id;
    await fetch('/api/admin/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, status: next })
    });
    archiving = null;
    await invalidateAll();
  }

  function statusChipClass(status: 'active' | 'archived') {
    return status === 'active' ? 'chip-open' : 'chip-closed';
  }

  function fmtDate(unix: number) {
    return new Date(unix * 1000).toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // Portal utility
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  // Focus action — call on an input to move focus without autofocus attribute
  function focusEl(node: HTMLElement) {
    node.focus();
  }
</script>

<section class="max-w-6xl mx-auto px-6 py-8 lg:px-8">
  <header in:fly={{ y: -8, duration: 320, easing: cubicOut }} class="mb-5">
    <div class="eyebrow mb-2">Admin</div>
    <h1 class="text-3xl font-bold tracking-tight">Projects</h1>
  </header>

  {#if data.pending.length > 0}
    <div class="glass p-4 mb-4" data-testid="pending-projects">
      <h2 class="text-sm font-semibold mb-1">Pending approval ({data.pending.length})</h2>
      <p class="text-xs text-fainter mb-3">
        Requested by users with "+ Add" on a new ticket. Approve the name, rename it, or move the
        tickets to an existing project.
      </p>
      {#if pendingError}
        <p class="text-xs mb-2" style="color: var(--color-danger);">{pendingError}</p>
      {/if}
      <ul class="space-y-3">
        {#each data.pending as p (p.id)}
          <li class="rounded-xl p-3 border" style="border-color: var(--glass-border);" data-testid="pending-project-{p.id}">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <input
                class="input h-9 text-sm flex-1 min-w-[160px]"
                aria-label="Project name"
                maxlength="80"
                value={pendingName[p.id] ?? p.name}
                oninput={(e) => (pendingName[p.id] = e.currentTarget.value)}
                data-testid="pending-name-{p.id}"
              />
              <button
                class="btn btn-primary h-9 text-xs"
                disabled={pendingBusy === p.id}
                onclick={() => renameAndApprove(p)}
                data-testid="pending-approve-{p.id}"
              >
                {(pendingName[p.id] ?? p.name).trim() !== p.name ? 'Rename and approve' : 'Approve'}
              </button>
            </div>
            <p class="text-xs text-muted mb-2">
              Requested by {p.requested_by ? p.requested_by.email : 'unknown'}
              on {fmtDate(p.created_at)}. Tickets:
              {#each p.tickets as t, i}<a class="link" href="/tickets/{t.id}">#{t.id}</a>{i < p.tickets.length - 1 ? ', ' : ''}{/each}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <select
                class="select h-9 text-xs flex-1 min-w-[160px]"
                aria-label="Move tickets to an existing project"
                bind:value={moveTarget[p.id]}
                data-testid="pending-target-{p.id}"
              >
                <option value="">Move tickets to an existing project...</option>
                {#each data.targets as t}<option value={String(t.id)}>{t.name}</option>{/each}
              </select>
              <button
                class="btn btn-ghost h-9 text-xs"
                disabled={!moveTarget[p.id] || pendingBusy === p.id}
                onclick={() => moveTickets(p)}
                data-testid="pending-move-{p.id}"
              >
                Move tickets
              </button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="glass p-3 flex flex-wrap items-center gap-3 mb-4">
    <label class="relative flex-1 min-w-[200px]">
      <span class="sr-only">Search projects</span>
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 text-fainter pointer-events-none"
           width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        class="input pl-9"
        placeholder="Search by name or slug…"
        bind:value={q}
      />
    </label>
    <span class="text-fainter font-mono text-xs">{filtered.length} shown</span>
    <button class="btn btn-primary text-sm w-full sm:w-auto" onclick={() => (showCreateModal = true)}>
      + New project
    </button>
  </div>

  <!-- Desktop table: lg+ -->
  <div class="glass overflow-hidden hidden lg:block">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-fainter text-xs uppercase tracking-wider"
              style="background: oklch(0 0 0 / 0.15);">
            <th class="font-semibold py-2.5 pl-4 pr-3">Name</th>
            <th class="font-semibold py-2.5 pr-3">Slug</th>
            <th class="font-semibold py-2.5 pr-3">Status</th>
            <th class="font-semibold py-2.5 pr-3 text-right">Tickets</th>
            <th class="font-semibold py-2.5 pr-3">Created</th>
            <th class="font-semibold py-2.5 pr-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as p (p.id)}
            <tr style="border-top: 1px solid var(--glass-border);">
              <td class="py-2.5 pl-4 pr-3 max-w-[260px]">
                {#if renamingId === p.id}
                  <form
                    class="flex items-center gap-2"
                    onsubmit={(e) => { e.preventDefault(); saveRename(); }}
                  >
                    <input
                      class="input h-8 text-sm flex-1"
                      bind:value={renameValue}
                      required
                      use:focusEl
                    />
                    <button type="submit" class="btn btn-primary h-8 text-xs px-2" disabled={renameSaving}>
                      {renameSaving ? '…' : 'Save'}
                    </button>
                    <button type="button" class="btn h-8 text-xs px-2" onclick={cancelRename}>Cancel</button>
                  </form>
                  {#if renameError}
                    <p class="text-xs mt-1" style="color: var(--color-danger);">{renameError}</p>
                  {/if}
                {:else}
                  <span class="truncate font-medium">{p.name}</span>
                {/if}
              </td>
              <td class="py-2.5 pr-3 font-mono text-fainter text-xs">{p.slug}</td>
              <td class="py-2.5 pr-3">
                <span class="chip {statusChipClass(p.status)}" data-testid="project-status-{p.id}">
                  {p.status}
                </span>
              </td>
              <td class="py-2.5 pr-3 text-right font-mono text-muted">{p.ticket_count}</td>
              <td class="py-2.5 pr-3 font-mono text-fainter text-xs whitespace-nowrap">{fmtDate(p.created_at)}</td>
              <td class="py-2.5 pr-4 text-right">
                <div class="flex items-center justify-end gap-3">
                  {#if renamingId !== p.id}
                    <button class="link text-xs" onclick={() => startRename(p)}>Rename</button>
                  {/if}
                  <button
                    class="link text-xs"
                    onclick={() => toggleArchive(p)}
                    disabled={archiving === p.id}
                    data-testid="archive-btn-{p.id}"
                  >
                    {p.status === 'archived' ? 'Unarchive' : 'Archive'}
                  </button>
                </div>
              </td>
            </tr>
          {/each}
          {#if filtered.length === 0}
            <tr>
              <td colspan="6" class="py-12 text-center text-fainter">
                {q ? 'No projects match your search.' : 'No projects yet.'}
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Mobile / tablet cards: below lg -->
  <ul class="lg:hidden space-y-3">
    {#each filtered as p (p.id)}
      <li class="glass p-3 rounded-xl">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="min-w-0 flex-1">
            {#if renamingId === p.id}
              <form
                class="flex items-center gap-2"
                onsubmit={(e) => { e.preventDefault(); saveRename(); }}
              >
                <input
                  class="input h-9 text-sm flex-1"
                  bind:value={renameValue}
                  required
                  use:focusEl
                />
                <button type="submit" class="btn btn-primary h-9 text-xs px-2" disabled={renameSaving}>
                  {renameSaving ? '…' : 'Save'}
                </button>
                <button type="button" class="btn h-9 text-xs px-2" onclick={cancelRename}>×</button>
              </form>
              {#if renameError}
                <p class="text-xs mt-1" style="color: var(--color-danger);">{renameError}</p>
              {/if}
            {:else}
              <div class="font-medium text-sm">{p.name}</div>
              <div class="text-xs font-mono text-fainter mt-0.5">{p.slug}</div>
            {/if}
          </div>
          <span class="chip {statusChipClass(p.status)} shrink-0" data-testid="project-status-{p.id}">
            {p.status}
          </span>
        </div>
        <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted mb-3">
          <div><dt class="opacity-60">Tickets</dt><dd class="font-mono">{p.ticket_count}</dd></div>
          <div><dt class="opacity-60">Created</dt><dd class="font-mono">{fmtDate(p.created_at)}</dd></div>
        </dl>
        <div class="flex gap-2 pt-2 border-t" style="border-color: var(--glass-border);">
          {#if renamingId !== p.id}
            <button class="btn btn-ghost h-9 flex-1 text-xs" onclick={() => startRename(p)}>
              Rename
            </button>
          {/if}
          <button
            class="btn btn-ghost h-9 flex-1 text-xs"
            onclick={() => toggleArchive(p)}
            disabled={archiving === p.id}
            data-testid="archive-btn-{p.id}"
          >
            {p.status === 'archived' ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </li>
    {/each}
    {#if filtered.length === 0}
      <li class="glass p-6 text-center text-fainter">
        {q ? 'No projects match your search.' : 'No projects yet.'}
      </li>
    {/if}
  </ul>
</section>

<!-- New project modal -->
{#if showCreateModal}
  <div
    use:portal
    class="fixed inset-0 z-[200] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 10vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="create-project-title"
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/50 p-0"
      aria-label="Dismiss"
      tabindex="-1"
      onclick={() => (showCreateModal = false)}
    ></button>

    <div
      class="glass relative z-10 w-full max-w-md p-6 rounded-xl"
      transition:fly={{ y: 12, duration: 200, easing: cubicOut }}
    >
      <h2 id="create-project-title" class="text-lg font-semibold mb-4">New project</h2>
      <form onsubmit={onCreate} class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-muted">Name</span>
          <input
            type="text"
            class="input"
            bind:value={newName}
            required
            maxlength="80"
            placeholder="e.g. Acme Corp"
            use:focusEl
          />
        </label>
        {#if previewSlug}
          <p class="text-xs text-fainter font-mono">
            slug: <span class="text-muted">{previewSlug}</span>
          </p>
        {/if}
        {#if createError}
          <p class="text-sm" style="color: var(--color-danger);">{createError}</p>
        {/if}
        <div class="flex justify-end gap-2 mt-2">
          <button type="button" class="btn" onclick={() => (showCreateModal = false)}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
