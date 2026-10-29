<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  type Props = {
    users: Array<{ id: number; email: string }>;
    projects: Array<{ id: number; name: string }>;
    filters: { userId: number | null; projectId: number | null };
  };
  const { users, projects, filters }: Props = $props();

  const userFilter = $derived(filters.userId != null ? String(filters.userId) : 'any');
  const projectFilter = $derived(filters.projectId != null ? String(filters.projectId) : 'any');
  const filtered = $derived(filters.userId != null || filters.projectId != null);

  function setFilter(key: 'user' | 'project', value: string) {
    const url = new URL(page.url);
    if (value === 'any') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

<div class="flex flex-wrap items-center gap-2 mb-4" data-testid="ticket-filters">
  <select
    class="select flex-1 min-w-[160px] sm:flex-none sm:w-64"
    aria-label="Filter by user"
    value={userFilter}
    onchange={(e) => setFilter('user', e.currentTarget.value)}
  >
    <option value="any">All users</option>
    {#each users as u (u.id)}
      <option value={String(u.id)}>{u.email}</option>
    {/each}
  </select>
  <select
    class="select flex-1 min-w-[160px] sm:flex-none sm:w-64"
    aria-label="Filter by project"
    value={projectFilter}
    onchange={(e) => setFilter('project', e.currentTarget.value)}
  >
    <option value="any">All projects</option>
    {#each projects as p (p.id)}
      <option value={String(p.id)}>{p.name}</option>
    {/each}
  </select>
  {#if filtered}
    <a href={page.url.pathname} class="btn btn-ghost text-sm">Clear filters</a>
  {/if}
</div>
