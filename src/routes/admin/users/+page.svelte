<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Avatar from '$lib/Avatar.svelte';

  type User = {
    id: number;
    email: string;
    role: 'user' | 'admin';
    theme: 'dark' | 'light';
    accent: string;
    email_schedule: string;
    disabled_at: number | null;
    created_at: number;
    last_seen: number | null;
    ticket_count: number;
  };

  type Project = { id: number; name: string; slug: string; status: string };

  type DeviceCounts = { mobile: number; tablet: number; desktop: number };
  type UserDeviceStats = {
    userId: number;
    totalSessions: number;
    counts: DeviceCounts;
    dominant: 'mobile' | 'tablet' | 'desktop' | null;
    usesPwa: boolean;
    topOs: string | null;
    latestSeen: number | null;
  };

  type Props = {
    data: {
      users: User[];
      q: string;
      devicesByUserId: Record<number, UserDeviceStats>;
      currentUserId: number;
      streakUserIds: number[];
    };
  };
  const { data }: Props = $props();

  // Rehydrate to a Set for O(1) lookup in the template.
  const streakSet = $derived(new Set(data.streakUserIds));

  function devicesFor(userId: number): UserDeviceStats | undefined {
    return data.devicesByUserId[userId];
  }

  /** Order chips so the dominant one renders first when there is one. */
  function deviceChips(stats: UserDeviceStats | undefined) {
    if (!stats || stats.totalSessions === 0) return [];
    const present: Array<{ kind: 'mobile' | 'tablet' | 'desktop'; count: number }> = [];
    if (stats.counts.mobile > 0) present.push({ kind: 'mobile', count: stats.counts.mobile });
    if (stats.counts.tablet > 0) present.push({ kind: 'tablet', count: stats.counts.tablet });
    if (stats.counts.desktop > 0) present.push({ kind: 'desktop', count: stats.counts.desktop });
    // Dominant first (if any), rest by count desc.
    present.sort((a, b) => {
      if (stats.dominant === a.kind) return -1;
      if (stats.dominant === b.kind) return 1;
      return b.count - a.count;
    });
    return present;
  }

  function deviceLabel(kind: 'mobile' | 'tablet' | 'desktop'): string {
    return kind === 'mobile' ? 'Mobile' : kind === 'tablet' ? 'Tablet' : 'Desktop';
  }

  let devicesDrawerFor = $state<User | null>(null);
  function devicePctFor(stats: UserDeviceStats, kind: 'mobile' | 'tablet' | 'desktop'): number {
    if (stats.totalSessions === 0) return 0;
    return Math.round((stats.counts[kind] / stats.totalSessions) * 100);
  }

  let q = $state('');
  $effect.pre(() => { q = data.q; });

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function onSearch(value: string) {
    q = value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const url = new URL($page.url);
      if (value) url.searchParams.set('q', value);
      else url.searchParams.delete('q');
      goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    }, 220);
  }

  async function toggleUser(u: User) {
    const op = u.disabled_at ? 'enable' : 'disable';
    if (op === 'disable' && !confirm('Disable this user? Their sessions will be revoked.')) return;
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: u.id, op })
    });
    await invalidateAll();
  }

  // ── Reset password modal (two-step confirmation) ────────────────────────────
  let resetModalUser = $state<User | null>(null);
  let resetting = $state(false);
  let resetError = $state<string | null>(null);
  let resetDone = $state(false);

  function openResetModal(u: User) {
    resetModalUser = u;
    resetting = false;
    resetError = null;
    resetDone = false;
  }

  function closeResetModal() {
    resetModalUser = null;
    resetError = null;
    resetDone = false;
  }

  async function confirmResetPassword() {
    if (!resetModalUser) return;
    // Second confirmation gate, on top of the modal itself.
    if (!confirm(`Email ${resetModalUser.email} a link to choose a new password?`)) return;
    resetting = true;
    resetError = null;
    const r = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resetModalUser.id, op: 'reset_password' })
    });
    resetting = false;
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      resetError = body.error || 'Failed to reset password';
      return;
    }
    resetDone = true;
  }

  function fmtTime(unix: number | null) {
    if (!unix) return '—';
    return new Date(unix * 1000).toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // ── Create user modal ───────────────────────────────────────────────────────
  let showCreateModal = $state(false);
  let newEmail = $state('');
  let newRole = $state<'user' | 'admin'>('user');
  let selectedProjectIds = $state<number[]>([]);
  let allProjects = $state<Project[]>([]);
  let creating = $state(false);
  let createError = $state<string | null>(null);

  async function loadProjects() {
    const r = await fetch('/api/admin/projects');
    if (r.ok) allProjects = (await r.json()).projects ?? [];
  }

  $effect(() => {
    if (showCreateModal) loadProjects();
  });

  async function onCreate(e: SubmitEvent) {
    e.preventDefault();
    creating = true;
    createError = null;
    const r = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, role: newRole, projectIds: selectedProjectIds })
    });
    creating = false;
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      createError = body.message || body.error || 'Failed to create user';
      return;
    }
    showCreateModal = false;
    newEmail = '';
    selectedProjectIds = [];
    await invalidateAll();
  }

  // ── Assign projects modal ──────────────────────────────────────────────────
  let projectsModalUser = $state<User | null>(null);
  let userProjectIds = $state<number[]>([]);
  let savingProjects = $state(false);
  let projectsError = $state<string | null>(null);

  async function openProjectsModal(u: User) {
    projectsModalUser = u;
    projectsError = null;
    await loadProjects();
    const r = await fetch(`/api/admin/users/${u.id}/projects`);
    if (r.ok) {
      const body = await r.json();
      userProjectIds = (body.projects as Project[]).map((p) => p.id);
    } else {
      userProjectIds = [];
    }
  }

  async function saveProjects() {
    if (!projectsModalUser) return;
    savingProjects = true;
    projectsError = null;
    const r = await fetch(`/api/admin/users/${projectsModalUser.id}/projects`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectIds: userProjectIds })
    });
    savingProjects = false;
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      projectsError = body.message || body.error || 'Failed to save';
      return;
    }
    projectsModalUser = null;
  }

  // Portal: teleport modal to <body> to escape stacking contexts
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  // ── Delete user modal ───────────────────────────────────────────────────────
  let deleteModalUser = $state<User | null>(null);
  let deleteConfirmInput = $state('');
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  function openDeleteModal(u: User) {
    deleteModalUser = u;
    deleteConfirmInput = '';
    deleting = false;
    deleteError = null;
  }

  function closeDeleteModal() {
    deleteModalUser = null;
    deleteConfirmInput = '';
    deleteError = null;
  }

  /** True when the typed value exactly matches the target email (case-insensitive, trimmed). */
  function deleteConfirmMatches(): boolean {
    return (
      deleteModalUser !== null &&
      deleteConfirmInput.trim().toLowerCase() === deleteModalUser.email.toLowerCase()
    );
  }

  async function confirmDelete() {
    if (!deleteModalUser || !deleteConfirmMatches()) return;
    deleting = true;
    deleteError = null;
    const r = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteModalUser.id, confirm_email: deleteConfirmInput.trim() })
    });
    deleting = false;
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      deleteError = body.error || 'Failed to delete user';
      return;
    }
    closeDeleteModal();
    await invalidateAll();
  }
</script>

<!--
  Snippets declared at template root so they are reachable from both the
  in-section table/cards and the device-detail drawer at the bottom.
  Svelte 5 snippet visibility is block-scoped to siblings — declaring them
  inside <section> would hide them from the drawer rendered outside it.
-->
{#snippet deviceIcon(kind: 'mobile' | 'tablet' | 'desktop')}
  {#if kind === 'mobile'}
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="7" y="2" width="10" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  {:else if kind === 'tablet'}
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  {:else}
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  {/if}
{/snippet}

{#snippet deviceChipList(u: User)}
  {@const stats = devicesFor(u.id)}
  {@const chips = deviceChips(stats)}
  {#if !stats || stats.totalSessions === 0}
    <span class="text-fainter text-xs">— never</span>
  {:else}
    <button
      type="button"
      class="flex flex-wrap items-center gap-1.5 text-left bg-transparent border-0 p-0 cursor-pointer"
      onclick={() => (devicesDrawerFor = u)}
      title="See device breakdown"
    >
      {#each chips as c}
        {@const isDominant = stats.dominant === c.kind}
        <span
          class="inline-flex items-center gap-1 chip"
          style={isDominant
            ? 'background: linear-gradient(135deg, var(--color-accent), var(--color-accent-2)); color: oklch(0.15 0.04 270); border-color: transparent; font-weight: 600;'
            : 'opacity: 0.6;'}
          aria-label={isDominant ? `${deviceLabel(c.kind)} (primary)` : deviceLabel(c.kind)}
        >
          {@render deviceIcon(c.kind)}
          <span class="text-[11px]">{deviceLabel(c.kind)}</span>
        </span>
      {/each}
      {#if stats.usesPwa}
        <span class="chip" style="background: var(--accent-wash-strong); border-color: var(--accent-line);"
              aria-label="Uses installed PWA at least once">
          <span class="text-[11px]">PWA</span>
        </span>
      {/if}
    </button>
  {/if}
{/snippet}

<section class="max-w-6xl mx-auto px-6 py-8 lg:px-8">
  <header in:fly={{ y: -8, duration: 320, easing: cubicOut }} class="mb-5">
    <div class="eyebrow mb-2">Admin</div>
    <h1 class="text-3xl font-bold tracking-tight">Users</h1>
  </header>

  <div class="glass p-3 flex flex-wrap items-center gap-3 mb-4">
    <label class="relative flex-1 min-w-[200px]">
      <span class="sr-only">Search users</span>
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 text-fainter pointer-events-none"
           width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input type="search" name="q" class="input pl-9" placeholder="Email or partial match…"
             value={q}
             oninput={(e) => onSearch((e.target as HTMLInputElement).value)} />
    </label>
    <span class="text-fainter font-mono text-xs">{data.users.length} shown</span>
    <button class="btn btn-primary text-sm w-full sm:w-auto" onclick={() => (showCreateModal = true)}>
      + New user
    </button>
  </div>

  <!-- Desktop table: visible at lg+ (≥1024px). Below 1024 the 8-column
       table overflows even the largest phones / portrait tablets, so
       the card layout below takes over. -->
  <div class="glass overflow-hidden hidden lg:block">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-fainter text-xs uppercase tracking-wider"
              style="background: oklch(0 0 0 / 0.15);">
            <th class="font-semibold py-2.5 pl-4 pr-2"></th>
            <th class="font-semibold py-2.5 pr-3">Email</th>
            <th class="font-semibold py-2.5 pr-3">Role</th>
            <th class="font-semibold py-2.5 pr-3 text-right">Tickets</th>
            <th class="font-semibold py-2.5 pr-3">Schedule</th>
            <th class="font-semibold py-2.5 pr-3">
              Devices
              <span class="block font-normal text-[10px] opacity-50 mt-0.5">(last 30d · bold = primary · click to expand)</span>
            </th>
            <th class="font-semibold py-2.5 pr-3 whitespace-nowrap">Last seen</th>
            <th class="font-semibold py-2.5 pr-3">Status</th>
            <th class="font-semibold py-2.5 pr-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each data.users as u}
            <tr style="border-top: 1px solid var(--glass-border);">
              <td class="py-2.5 pl-4 pr-2"><Avatar email={u.email} size={24} /></td>
              <td class="py-2.5 pr-3 truncate max-w-[260px]">{u.email}</td>
              <td class="py-2.5 pr-3">
                <span class="chip {u.role === 'admin' ? 'chip-urgent' : ''}">{u.role}</span>
              </td>
              <td class="py-2.5 pr-3 text-right font-mono text-muted">{u.ticket_count}</td>
              <td class="py-2.5 pr-3 font-mono text-fainter text-xs">{u.email_schedule}</td>
              <td class="py-2.5 pr-3">{@render deviceChipList(u)}</td>
              <td class="py-2.5 pr-3 font-mono text-fainter text-xs whitespace-nowrap">{fmtTime(u.last_seen)}</td>
              <td class="py-2.5 pr-3">
                {#if u.disabled_at}
                  <span class="chip chip-closed"
                        title="Account disabled — sessions revoked">disabled</span>
                {:else if streakSet.has(u.id)}
                  <span class="chip chip-open"
                        title="3 consecutive days from the same device in the last week">active</span>
                {:else}
                  <span class="chip chip-pending"
                        title="Account enabled but no recent activity streak">idle</span>
                {/if}
              </td>
              <td class="py-2.5 pr-4 text-right flex items-center justify-end gap-3">
                <button class="link text-xs" onclick={() => openProjectsModal(u)}>
                  Projects
                </button>
                <button class="link text-xs" onclick={() => toggleUser(u)}>
                  {u.disabled_at ? 'Enable' : 'Disable'}
                </button>
                <button class="link text-xs" onclick={() => openResetModal(u)}>
                  Reset password
                </button>
                {#if u.id !== data.currentUserId}
                  <button
                    class="link text-xs"
                    style="color: var(--color-danger);"
                    onclick={() => openDeleteModal(u)}
                  >
                    Delete
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
          {#if data.users.length === 0}
            <tr><td colspan="9" class="py-12 text-center text-fainter">No users.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Mobile / tablet cards: visible below lg (<1024px). -->
  <ul class="lg:hidden space-y-3">
    {#each data.users as u}
      <li class="glass p-3 rounded-xl">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="min-w-0 flex-1 flex items-center gap-2">
            <Avatar email={u.email} size={32} />
            <div class="min-w-0">
              <div class="font-medium text-sm truncate">{u.email}</div>
              <div class="text-xs text-muted font-mono">{u.email_schedule}</div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <span class="chip {u.role === 'admin' ? 'chip-urgent' : ''}">{u.role}</span>
            {#if u.disabled_at}
              <span class="chip chip-closed"
                    title="Account disabled — sessions revoked">disabled</span>
            {:else if streakSet.has(u.id)}
              <span class="chip chip-open"
                    title="3 consecutive days from the same device in the last week">active</span>
            {:else}
              <span class="chip chip-pending"
                    title="Account enabled but no recent activity streak">idle</span>
            {/if}
          </div>
        </div>
        <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted mb-3">
          <div><dt class="opacity-60">Tickets</dt><dd class="font-mono">{u.ticket_count}</dd></div>
          <div><dt class="opacity-60">Last seen</dt><dd class="font-mono">{fmtTime(u.last_seen)}</dd></div>
        </dl>
        <div class="mb-3">
          <div class="opacity-60 text-xs text-muted mb-1.5">Devices (30d)</div>
          {@render deviceChipList(u)}
        </div>
        <div class="flex gap-2 pt-2 border-t" style="border-color: var(--glass-border);">
          <button class="btn btn-ghost h-9 flex-1 text-xs" onclick={() => openProjectsModal(u)}>
            Projects
          </button>
          <button class="btn btn-ghost h-9 flex-1 text-xs" onclick={() => toggleUser(u)}>
            {u.disabled_at ? 'Enable' : 'Disable'}
          </button>
          <button class="btn btn-ghost h-9 flex-1 text-xs" onclick={() => openResetModal(u)}>
            Reset password
          </button>
          {#if u.id !== data.currentUserId}
            <button
              class="btn btn-ghost h-9 flex-1 text-xs"
              style="color: var(--color-danger);"
              onclick={() => openDeleteModal(u)}
            >
              Delete
            </button>
          {/if}
        </div>
      </li>
    {/each}
    {#if data.users.length === 0}
      <li class="glass p-6 text-center text-fainter">No users.</li>
    {/if}
  </ul>
</section>

<!-- Create user modal -->
{#if showCreateModal}
  <div
    use:portal
    class="fixed inset-0 z-[200] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 10vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="create-user-title"
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/50 p-0"
      aria-label="Dismiss"
      tabindex="-1"
      onclick={() => (showCreateModal = false)}
    ></button>

    <div class="glass relative z-10 w-full max-w-md p-6 rounded-xl" transition:fly={{ y: 12, duration: 200, easing: cubicOut }}>
      <h2 id="create-user-title" class="text-lg font-semibold mb-4">Create new user</h2>
      <form onsubmit={onCreate} class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-muted">Email</span>
          <input type="email" class="input" bind:value={newEmail} required placeholder="user@example.com" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-muted">Role</span>
          <select class="input" bind:value={newRole}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        {#if allProjects.length > 0}
          <fieldset class="border-0 p-0 m-0">
            <legend class="text-sm text-muted mb-1">Assign projects</legend>
            <div class="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {#each allProjects as p}
                <label class="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" bind:group={selectedProjectIds} value={p.id} />
                  {p.name}
                  {#if p.status !== 'active'}
                    <span class="chip text-xs">{p.status}</span>
                  {/if}
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}
        {#if createError}
          <p class="text-sm" style="color: var(--color-danger);">{createError}</p>
        {/if}
        <div class="flex justify-end gap-2 mt-2">
          <button type="button" class="btn" onclick={() => (showCreateModal = false)}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Assign projects modal -->
{#if projectsModalUser}
  <div
    use:portal
    class="fixed inset-0 z-[200] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 10vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="projects-modal-title"
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/50 p-0"
      aria-label="Dismiss"
      tabindex="-1"
      onclick={() => (projectsModalUser = null)}
    ></button>

    <div class="glass relative z-10 w-full max-w-md p-6 rounded-xl" transition:fly={{ y: 12, duration: 200, easing: cubicOut }}>
      <h2 id="projects-modal-title" class="text-lg font-semibold mb-1">Assign projects</h2>
      <p class="text-sm text-muted mb-4">{projectsModalUser.email}</p>
      <div class="flex flex-col gap-1 max-h-60 overflow-y-auto mb-4">
        {#if allProjects.length === 0}
          <p class="text-sm text-fainter">No projects available.</p>
        {/if}
        {#each allProjects as p}
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" bind:group={userProjectIds} value={p.id} />
            {p.name}
            {#if p.status !== 'active'}
              <span class="chip text-xs">{p.status}</span>
            {/if}
          </label>
        {/each}
      </div>
      {#if projectsError}
        <p class="text-sm mb-2" style="color: var(--color-danger);">{projectsError}</p>
      {/if}
      <div class="flex justify-end gap-2">
        <button class="btn" onclick={() => (projectsModalUser = null)}>Cancel</button>
        <button class="btn btn-primary" disabled={savingProjects} onclick={saveProjects}>
          {savingProjects ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Devices drawer · click on the DEVICES chips opens this -->
{#if devicesDrawerFor}
  {@const _stats = devicesFor(devicesDrawerFor.id)}
  <div
    use:portal
    class="fixed inset-0 z-[200] flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 10vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="devices-drawer-title"
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/50 p-0"
      aria-label="Dismiss"
      tabindex="-1"
      onclick={() => (devicesDrawerFor = null)}
    ></button>

    <div class="glass relative z-10 w-full max-w-md p-6 rounded-xl"
         transition:fly={{ y: 12, duration: 200, easing: cubicOut }}>
      <h2 id="devices-drawer-title" class="text-lg font-semibold mb-1">Devices · last 30 days</h2>
      <p class="text-sm text-muted mb-4">{devicesDrawerFor.email}</p>

      {#if !_stats || _stats.totalSessions === 0}
        <p class="text-sm text-fainter">No sessions in the last 30 days.</p>
      {:else}
        <p class="text-xs text-fainter mb-3 font-mono">{_stats.totalSessions} sessions</p>

        <div class="space-y-2 mb-4">
          {#each ['mobile', 'tablet', 'desktop'] as const as kind}
            {@const pct = devicePctFor(_stats, kind)}
            {#if _stats.counts[kind] > 0}
              {@const isDominant = _stats.dominant === kind}
              <div class="flex items-center gap-3">
                <div class="w-20 text-xs flex items-center gap-1.5"
                     style={isDominant ? 'font-weight: 600;' : 'opacity: 0.7;'}>
                  {@render deviceIcon(kind)}
                  {deviceLabel(kind)}
                </div>
                <div class="flex-1 h-2 rounded overflow-hidden"
                     style="background: var(--glass-tint);">
                  <div class="h-full"
                       style="width: {pct}%; background: {isDominant
                         ? 'linear-gradient(90deg, var(--color-accent), var(--color-accent-2))'
                         : 'var(--color-muted)'};"></div>
                </div>
                <div class="w-16 text-right font-mono text-xs"
                     style={isDominant ? 'color: var(--color-text); font-weight: 600;' : 'color: var(--color-muted);'}>
                  {pct}% · {_stats.counts[kind]}
                </div>
              </div>
            {/if}
          {/each}
        </div>

        <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-muted">
          <div>
            <dt class="opacity-60">Top OS</dt>
            <dd class="font-mono">{_stats.topOs ?? '—'}</dd>
          </div>
          <div>
            <dt class="opacity-60">PWA installed</dt>
            <dd class="font-mono">{_stats.usesPwa ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt class="opacity-60">Latest session</dt>
            <dd class="font-mono">{fmtTime(_stats.latestSeen)}</dd>
          </div>
          <div>
            <dt class="opacity-60">Dominant</dt>
            <dd class="font-mono">{_stats.dominant ?? 'tied'}</dd>
          </div>
        </dl>
      {/if}

      <div class="flex justify-end mt-5">
        <button class="btn" onclick={() => (devicesDrawerFor = null)}>Close</button>
      </div>
    </div>
  </div>
{/if}

<!-- Reset password modal -->
{#if resetModalUser}
  <div
    use:portal
    class="fixed inset-0 z-200 flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 10vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="reset-password-title"
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/50 p-0"
      aria-label="Dismiss"
      tabindex="-1"
      onclick={closeResetModal}
    ></button>

    <div class="glass relative z-10 w-full max-w-md p-6 rounded-xl" transition:fly={{ y: 12, duration: 200, easing: cubicOut }}>
      <h2 id="reset-password-title" class="text-lg font-semibold mb-3">Reset password</h2>

      {#if resetDone}
        <p class="text-sm text-muted mb-4">
          A link to choose a new password was emailed to <strong>{resetModalUser.email}</strong>.
          Their previous password and any passkeys no longer work and their sessions were revoked.
        </p>
        <div class="flex justify-end">
          <button class="btn btn-primary" onclick={closeResetModal}>Close</button>
        </div>
      {:else}
        <p class="text-sm text-muted mb-4">
          This will invalidate the current password and passkeys of <strong>{resetModalUser.email}</strong>,
          revoke all of their active sessions and email them a link (valid 24 hours) to choose a new one.
        </p>

        {#if resetError}
          <p class="text-sm mb-3" style="color: var(--color-danger);">{resetError}</p>
        {/if}

        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onclick={closeResetModal} disabled={resetting}>
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={resetting}
            onclick={confirmResetPassword}
          >
            {resetting ? 'Sending…' : 'Reset password'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Delete user modal -->
{#if deleteModalUser}
  <div
    use:portal
    class="fixed inset-0 z-200 flex items-start justify-center px-4 pb-4 overflow-y-auto"
    style="padding-top: 10vh;"
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-user-title"
    transition:fade={{ duration: 160 }}
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/50 p-0"
      aria-label="Dismiss"
      tabindex="-1"
      onclick={closeDeleteModal}
    ></button>

    <div class="glass relative z-10 w-full max-w-md p-6 rounded-xl" transition:fly={{ y: 12, duration: 200, easing: cubicOut }}>
      <h2 id="delete-user-title" class="text-lg font-semibold mb-3">Delete user permanently</h2>

      <!-- Blast-radius warning -->
      <div class="rounded-lg p-4 mb-4 text-sm"
           style="background: oklch(0.4 0.18 25 / 0.12); border: 1px solid oklch(0.55 0.2 25 / 0.35);">
        <p style="color: var(--color-danger);" class="font-semibold mb-1">This action cannot be undone.</p>
        <p class="text-muted">
          This will delete <strong>{deleteModalUser.email}</strong>, their
          <strong>{deleteModalUser.ticket_count}</strong> ticket{deleteModalUser.ticket_count === 1 ? '' : 's'},
          every message and reaction they posted, their sessions, group memberships,
          project assignments, and pending uploads.
        </p>
      </div>

      <!-- Typed-email confirmation input -->
      <label class="flex flex-col gap-1.5 mb-4">
        <span class="text-sm text-muted">
          Type <strong>{deleteModalUser.email}</strong> to confirm:
        </span>
        <input
          type="email"
          class="input"
          autocomplete="off"
          placeholder={deleteModalUser.email}
          bind:value={deleteConfirmInput}
          onkeydown={(e) => { if (e.key === 'Enter' && deleteConfirmMatches()) confirmDelete(); }}
        />
      </label>

      {#if deleteError}
        <p class="text-sm mb-3" style="color: var(--color-danger);">{deleteError}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <button type="button" class="btn" onclick={closeDeleteModal} disabled={deleting}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          style="background: var(--color-danger); border-color: var(--color-danger);"
          disabled={!deleteConfirmMatches() || deleting}
          onclick={confirmDelete}
        >
          {deleting ? 'Deleting…' : 'Delete user'}
        </button>
      </div>
    </div>
  </div>
{/if}
