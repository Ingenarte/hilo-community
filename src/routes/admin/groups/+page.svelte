<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  type Group = {
    id: number;
    project_id: number;
    project_name: string;
    name: string;
    created_at: number;
    member_count: number;
    ticket_count: number;
  };
  type Project = { id: number; name: string; slug: string };
  type UserOption = { id: number; email: string; role: 'user' | 'admin' };

  type Props = {
    data: { groups: Group[]; projects: Project[]; users: UserOption[] };
  };

  const { data }: Props = $props();

  let newName = $state('');
  let newProjectId = $state<number | ''>('');
  let creating = $state(false);
  let createError = $state<string | null>(null);

  // Members modal state
  let membersGroup = $state<Group | null>(null);
  let memberIds = $state<number[]>([]);
  let loadingMembers = $state(false);
  let saving = $state(false);

  async function createGroup() {
    if (!newName.trim() || !newProjectId) return;
    creating = true;
    createError = null;
    const r = await fetch('/api/admin/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: newProjectId, name: newName.trim() })
    });
    creating = false;
    if (!r.ok) {
      createError = (await r.json().catch(() => ({}))).error || 'Failed to create group';
      return;
    }
    newName = '';
    newProjectId = '';
    await invalidateAll();
  }

  async function rename(g: Group) {
    const next = prompt(`Rename group "${g.name}":`, g.name);
    if (!next || next.trim() === g.name) return;
    const r = await fetch(`/api/admin/groups/${g.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next.trim() })
    });
    if (r.ok) await invalidateAll();
  }

  async function deleteGroup(g: Group) {
    const msg =
      g.ticket_count > 0
        ? `Delete "${g.name}"? ${g.ticket_count} ticket(s) will lose their group tag.`
        : `Delete "${g.name}"?`;
    if (!confirm(msg)) return;
    const r = await fetch(`/api/admin/groups/${g.id}`, { method: 'DELETE' });
    if (r.ok) await invalidateAll();
  }

  async function openMembers(g: Group) {
    membersGroup = g;
    loadingMembers = true;
    const r = await fetch(`/api/admin/groups/${g.id}/members`);
    const j = (await r.json()) as { members: Array<{ id: number }> };
    memberIds = j.members.map((m) => m.id);
    loadingMembers = false;
  }

  async function saveMembers() {
    if (!membersGroup) return;
    saving = true;
    await fetch(`/api/admin/groups/${membersGroup.id}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: memberIds })
    });
    saving = false;
    membersGroup = null;
    await invalidateAll();
  }

  function toggleMember(uid: number) {
    memberIds = memberIds.includes(uid)
      ? memberIds.filter((x) => x !== uid)
      : [...memberIds, uid];
  }
</script>

<main class="px-4 py-6 max-w-4xl mx-auto">
  <header class="flex flex-wrap items-center justify-between gap-3 mb-6">
    <h1 class="text-2xl font-bold tracking-tight">Groups</h1>
    <a href="/admin" class="text-sm text-muted underline">← Back to admin</a>
  </header>

  <section class="glass p-4 mb-6">
    <h2 class="text-sm font-semibold mb-3 text-muted">Create a new group</h2>
    <div class="flex flex-wrap gap-2 items-stretch">
      <select bind:value={newProjectId}
              class="input w-full sm:w-[200px] sm:max-w-[200px]"
              style="height:40px;">
        <option value="">— Project —</option>
        {#each data.projects as p}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
      <input
        bind:value={newName}
        type="text"
        placeholder="Group name (e.g. Frontend)"
        class="input w-full sm:flex-1 sm:min-w-[200px]"
        style="height:40px;"
        maxlength="80"
      />
      <button
        type="button"
        class="btn btn-primary w-full sm:w-auto"
        style="height:40px;"
        onclick={createGroup}
        disabled={creating || !newName.trim() || !newProjectId}
      >
        {creating ? 'Creating…' : 'Create group'}
      </button>
    </div>
    {#if createError}
      <p class="text-xs mt-2" style="color: var(--color-danger);">{createError}</p>
    {/if}
  </section>

  <section class="glass p-4">
    <h2 class="text-sm font-semibold mb-3 text-muted">All groups</h2>
    {#if data.groups.length === 0}
      <p class="text-muted text-sm">
        No groups yet. Create one above and then add members.
      </p>
    {:else}
      <ul class="divide-y" style="--tw-divide-opacity:0.1; border-color: oklch(0.5 0 0 / 0.15);">
        {#each data.groups as g}
          <li class="flex items-center gap-3 py-2.5">
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">
                <span class="text-faint mr-1">{g.project_name} /</span>{g.name}
              </div>
              <div class="text-xs text-muted mt-0.5">
                {g.member_count} member{g.member_count === 1 ? '' : 's'} ·
                {g.ticket_count} ticket{g.ticket_count === 1 ? '' : 's'}
              </div>
            </div>
            <button class="btn btn-ghost" onclick={() => openMembers(g)}>Members</button>
            <button class="btn btn-ghost" onclick={() => rename(g)}>Rename</button>
            <button class="btn btn-ghost" style="color: var(--color-danger);" onclick={() => deleteGroup(g)}>Delete</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

{#if membersGroup}
  <div
    class="fixed inset-0 z-[200] flex items-start justify-center px-4 py-12 overflow-y-auto"
    role="dialog"
    aria-modal="true"
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/75 p-0"
      aria-label="Dismiss"
      onclick={() => (membersGroup = null)}
    ></button>
    <div class="glass-strong relative z-10 w-full max-w-md p-6">
      <h2 class="text-base font-bold tracking-tight mb-1">
        Members of {membersGroup.project_name} / {membersGroup.name}
      </h2>
      <p class="text-xs text-muted mb-4">
        Each member sees every ticket tagged with this group.
      </p>
      {#if loadingMembers}
        <p class="text-muted text-sm">Loading…</p>
      {:else}
        <ul class="max-h-72 overflow-y-auto -mx-2 px-2">
          {#each data.users as u}
            <li>
              <label class="flex items-center gap-2 py-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded"
                  checked={memberIds.includes(u.id)}
                  onchange={() => toggleMember(u.id)}
                />
                <span class="text-sm">
                  {u.email}{u.role === 'admin' ? ' · admin' : ''}
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="flex items-center justify-end gap-2 mt-4">
        <button class="btn" onclick={() => (membersGroup = null)}>Cancel</button>
        <button class="btn btn-primary" onclick={saveMembers} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </div>
{/if}
