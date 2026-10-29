<script lang="ts">
  import BulkActionsBar from '$lib/BulkActionsBar.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { saveTicketNav } from '$lib/ticketNav';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import ExportCsvButton from '$lib/ExportCsvButton.svelte';

  type Ticket = {
    id: number;
    title: string;
    status: 'open' | 'pending' | 'closed';
    priority: 'urgent' | 'high' | 'normal' | 'low';
    user_email: string;
    projects: string[];
    message_count: number;
    unread_count: number;
    updated_at: number; // unix epoch seconds
    unread?: boolean;
    // Sprint43: read-receipt eye fields — both come from queryTickets subqueries
    latest_admin_reply_at: number | null;
    owner_last_read_at: number | null;
    // Sprint44: archive state
    archived_at: number | null;
  };

  type Project = { id: number; name: string; slug: string };
  type TaskHint = { id: number; title: string; description: string };

  type Props = {
    data: {
      tickets: Ticket[];
      myTasksByTicket: Record<number, TaskHint[]>;
      total: number;
      page: number;
      perPage: number;
      hasMore: boolean;
      projects: Project[];
      users: Array<{ id: number; email: string }>;
      filters: { search: string; status: string; statusDefault: boolean; priority: string; projectId: number | null; userId: number | null; archived: boolean };
      isAdmin: boolean;
    };
  };

  const { data }: Props = $props();

  // Remember this list's order so a ticket opened from it can offer
  // previous / next without going back to the list.
  $effect(() => {
    saveTicketNav({
      href: page.url.pathname + page.url.search,
      source: 'inbox',
      ids: data.tickets.map((t) => t.id)
    });
  });

  function tasksFor(ticketId: number): TaskHint[] {
    return data.myTasksByTicket[ticketId] ?? [];
  }

  // local input state, mirrored from server-provided filters
  let q = $state('');
  let status = $state('active');
  let priority = $state('any');
  let project = $state<string>('any');
  let owner = $state<string>('any');
  let archived = $state(false);

  // Mobile filter panel toggle
  let filtersOpen = $state(false);

  $effect.pre(() => {
    q = data.filters.search;
    status = data.filters.status;
    priority = data.filters.priority;
    project = data.filters.projectId == null ? 'any' : String(data.filters.projectId);
    owner = data.filters.userId == null ? 'any' : String(data.filters.userId);
    archived = data.filters.archived;
  });

  // selection (admin only)
  let selected = $state<Set<number>>(new Set());

  // Hover popover for the "Pending task" chips. One viewport-positioned
  // panel shared across every chip — cheaper than building one popover
  // per row, and the popover persists if the cursor moves onto it (so
  // the user can read long descriptions without the panel disappearing).
  let hoveredTask = $state<
    {
      id: number;
      anchorRect: { left: number; bottom: number; width: number };
      title: string;
      description: string;
    } | null
  >(null);
  let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;

  function showTaskHover(e: MouseEvent | FocusEvent, task: TaskHint) {
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    hoveredTask = {
      id: task.id,
      anchorRect: { left: rect.left, bottom: rect.bottom, width: rect.width },
      title: task.title,
      description: task.description
    };
  }

  function scheduleHoverClose() {
    if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
    hoverCloseTimer = setTimeout(() => {
      hoveredTask = null;
    }, 120);
  }

  function keepHoverOpen() {
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  }

  // search debounce
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function onSearch(value: string) {
    q = value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => syncFilters({ q: value }), 220);
  }

  // URL params: q, status, priority, project, archived (matches +page.server.ts)
  function syncFilters(patch: Partial<{ q: string; status: string; priority: string; project: string; user: string; archived: boolean }>) {
    const url = new URL(page.url);
    const next = {
      q,
      status,
      priority,
      project,
      user: owner,
      archived,
      ...patch
    };
    // q
    if (!next.q) url.searchParams.delete('q'); else url.searchParams.set('q', next.q);
    // status / priority — 'any' is default
    if (next.status === 'active' || !next.status) url.searchParams.delete('status'); else url.searchParams.set('status', next.status);
    if (next.priority === 'any' || !next.priority) url.searchParams.delete('priority'); else url.searchParams.set('priority', next.priority);
    // project — server expects numeric projectId; 'any' is default
    if (!next.project || next.project === 'any') url.searchParams.delete('project'); else url.searchParams.set('project', next.project);
    // user — numeric ticket author id (admins only); 'any' is default
    if (!next.user || next.user === 'any') url.searchParams.delete('user'); else url.searchParams.set('user', next.user);
    // archived — server uses '1' (boolean string)
    if (next.archived) url.searchParams.set('archived', '1'); else url.searchParams.delete('archived');
    url.searchParams.delete('page');
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function toggleAll(checked: boolean) {
    selected = checked ? new Set(data.tickets.map((t) => t.id)) : new Set();
  }

  function toggleOne(id: number) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    selected = next;
  }

  async function toggleArchiveOne(t: Ticket) {
    await fetch(`/api/tickets/${t.id}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: !t.archived_at })
    });
    await invalidateAll();
  }

  // Bulk actions live in the shared <BulkActionsBar>; it reports back here.
  let bulkNotice = $state<string | null>(null);
  let bulkNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  async function onBulkDone(info: { message: string }) {
    selected = new Set();
    bulkNotice = info.message;
    if (bulkNoticeTimer) clearTimeout(bulkNoticeTimer);
    bulkNoticeTimer = setTimeout(() => (bulkNotice = null), 6000);
    await invalidateAll();
  }

  const pageCount = $derived(Math.max(1, Math.ceil(data.total / data.perPage)));
  const hasFilters = $derived(
    !!(data.filters.search || !data.filters.statusDefault || (data.filters.priority !== 'any') || (data.filters.projectId != null) || (data.filters.userId != null) || data.filters.archived)
  );

  // Count of active (non-default) filters for the mobile "Filters" badge
  const activeFilterCount = $derived(
    (q ? 1 : 0) +
    (!data.filters.statusDefault ? 1 : 0) +
    (priority !== 'any' ? 1 : 0) +
    (project !== 'any' ? 1 : 0) +
    (owner !== 'any' ? 1 : 0) +
    (archived ? 1 : 0)
  );

  function relTime(unix: number): string {
    const d = unix * 1000;
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 172800) return 'yesterday';
    return `${Math.floor(diff / 86400)}d ago`;
  }

  // Sprint43: read-receipt eye helpers (admin-only rendering)
  function seenStatus(t: Ticket): 'seen' | 'sent' | null {
    if (!t.latest_admin_reply_at) return null;
    if ((t.owner_last_read_at ?? 0) >= t.latest_admin_reply_at) return 'seen';
    return 'sent';
  }

  function seenTooltip(t: Ticket): string {
    const s = seenStatus(t);
    if (s === 'seen') {
      return `Seen ${relTime(t.owner_last_read_at!)} after your reply ${relTime(t.latest_admin_reply_at!)}`;
    }
    if (s === 'sent') {
      return `Replied ${relTime(t.latest_admin_reply_at!)} · owner has not opened it yet`;
    }
    return '';
  }
</script>

<section
  class="max-w-6xl mx-auto px-6 py-8 lg:px-8"
  style:padding-bottom={data.isAdmin && selected.size > 0
    ? 'calc(10rem + env(safe-area-inset-bottom, 0px))'
    : undefined}
>
  <header class="flex flex-wrap items-center justify-between gap-3 mb-6"
          in:fly={{ y: -8, duration: 320, easing: cubicOut }}>
    <div>
      <div class="eyebrow mb-2">
        {data.isAdmin ? 'Admin · inbox' : 'Your conversations'}
      </div>
      <h1 class="text-3xl font-bold tracking-tight">
        {data.isAdmin ? 'All tickets' : 'My tickets'}
      </h1>
    </div>

    <div class="flex gap-2">
      {#if data.isAdmin}
        <ExportCsvButton />
      {/if}
      <a href="/tickets/new" class="btn btn-primary" aria-label="New ticket">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New ticket
      </a>
    </div>
  </header>

  <!-- Filter bar: mobile toggle button (only visible below 640px) -->
  <button
    type="button"
    class="sm:hidden btn btn-ghost mb-3 flex items-center gap-2 btn-lg"
    aria-expanded={filtersOpen}
    onclick={() => (filtersOpen = !filtersOpen)}
    in:fly={{ y: -4, duration: 280, easing: cubicOut }}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
    Filters
    {#if activeFilterCount > 0}
      <span class="badge-unread">{activeFilterCount}</span>
    {/if}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
         class={filtersOpen ? 'rotate-180 transition-transform' : 'transition-transform'}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  <!-- Filter controls: always visible on sm+, conditionally on mobile -->
  <div class="{filtersOpen ? 'block' : 'hidden'} sm:block">
    <div class="glass p-3 flex flex-wrap items-center gap-2.5"
         in:fly={{ y: -4, duration: 280, easing: cubicOut }}>
      <label class="relative flex-[2] min-w-[200px]">
        <span class="sr-only">Search</span>
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 text-fainter pointer-events-none"
             width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          name="q"
          class="input pl-9"
          placeholder="Search title, body, sender…"
          value={q}
          oninput={(e) => onSearch((e.target as HTMLInputElement).value)}
        />
      </label>

      <select class="select flex-1 min-w-[150px]"
              aria-label="Status"
              title="Active hides closed tickets"
              bind:value={status}
              onchange={() => syncFilters({ status })}>
        <option value="active">Active</option>
        <option value="open">Open</option>
        <option value="pending">Pending</option>
        <option value="closed">Closed</option>
        <option value="any">All (with closed)</option>
      </select>

      <select class="select flex-1 min-w-[140px]" aria-label="Priority"
              bind:value={priority}
              onchange={() => syncFilters({ priority })}>
        <option value="any">All priority</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="normal">Normal</option>
        <option value="low">Low</option>
      </select>

      <select class="select flex-1 min-w-[140px]" aria-label="Project"
              bind:value={project}
              onchange={() => syncFilters({ project })}>
        <option value="any">All projects</option>
        {#each data.projects as p}
          <option value={String(p.id)}>{p.name}</option>
        {/each}
      </select>

      {#if data.isAdmin}
        <select class="select flex-1 min-w-[160px]" aria-label="Filter by user" data-testid="filter-user"
                bind:value={owner}
                onchange={() => syncFilters({ user: owner })}>
          <option value="any">All users</option>
          {#each data.users as u (u.id)}
            <option value={String(u.id)}>{u.email}</option>
          {/each}
        </select>

        <label class="flex items-center gap-2.5 py-2 text-sm text-muted ml-1 select-none cursor-pointer">
          <input type="checkbox" bind:checked={archived}
                 onchange={() => syncFilters({ archived })} />
          Show archived
        </label>
      {/if}

      <span class="ml-auto text-fainter text-xs num">{data.total} total</span>
    </div>
  </div>

  <!-- Bulk actions (admin) -->
  {#if data.isAdmin}
    <BulkActionsBar
      ids={[...selected]}
      mode="inbox"
      archivedView={data.filters.archived}
      ondone={onBulkDone}
      onclear={() => (selected = new Set())}
    />
  {/if}

  {#if bulkNotice}
    <p class="glass mt-3 px-4 py-2.5 text-sm" role="status" data-testid="bulk-notice">{bulkNotice}</p>
  {/if}

  <!-- List -->
  {#if data.tickets.length === 0}
    <div class="glass mt-6 py-20 px-6 text-center"
         in:fly={{ y: 8, duration: 380, easing: cubicOut }}>
      <div class="mx-auto mb-5 h-14 w-14 rounded-2xl flex items-center justify-center"
           style="background: var(--accent-wash); color: var(--color-accent); border: 1px solid var(--accent-line);">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      </div>
      <div class="text-lg font-bold tracking-tight mb-1">
        {hasFilters ? 'Nothing matches those filters' : 'No tickets yet'}
      </div>
      <div class="text-muted text-sm max-w-sm mx-auto mb-5">
        {hasFilters
          ? 'Try widening the search or clearing one of the dropdowns above.'
          : data.isAdmin
            ? 'When a user opens a thread, it will land here.'
            : 'Start a thread and the admin will reply by email and in-app.'}
      </div>
      {#if !hasFilters && !data.isAdmin}
        <a href="/tickets/new" class="btn btn-primary">Create ticket</a>
      {/if}
    </div>
  {:else}
    <ul class="glass inbox-list mt-4 anim-fade-in" class:has-selection={selected.size > 0} data-testid="inbox-list">
      {#each data.tickets as t (t.id)}
        {@const myTasks = tasksFor(t.id)}
        <li class="group inbox-row" class:is-selected={selected.has(t.id)}>
          <article
            class="relative px-4 py-3.5"
            class:is-selected={selected.has(t.id)}
            class:tk-unread={t.unread_count > 0}
            class:tk-task={myTasks.length > 0}
            class:tk-archived={t.archived_at != null}
          >
            <a
              href={`/tickets/${t.id}`}
              class="absolute inset-0 z-0"
              aria-label={`Open ticket #${t.id}: ${t.title}`}
            ></a>

            <div class="relative z-10 flex items-start gap-3 pointer-events-none">
              {#if data.isAdmin}
                <span class="mt-1 pointer-events-auto row-check">
                  <input
                    type="checkbox"
                    aria-label="Select ticket {t.id}"
                    checked={selected.has(t.id)}
                    onchange={() => toggleOne(t.id)}
                    onclick={(e) => e.stopPropagation()}
                  />
                </span>
              {/if}

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                  {#if t.unread_count > 0}
                    <span
                      class="unread-dot"
                      aria-hidden="true"
                      title={t.unread_count > 9 ? '9+ unread' : `${t.unread_count} unread`}
                    ></span>
                  {/if}
                  <span class="num text-fainter text-[11px]">#{t.id}</span>
                  <span class="chip chip-{t.status}">
                    <span class="inline-block w-1.5 h-1.5 rounded-full"
                          style="background: currentColor;"></span>
                    {t.status}
                  </span>
                  {#if t.priority !== 'normal'}
                    <span class="chip chip-{t.priority}">{t.priority}</span>
                  {/if}
                  {#each t.projects as p}
                    <span class="chip chip-project">{p}</span>
                  {/each}
                  {#if t.unread_count > 0}
                    <span
                      class="badge-unread ml-0.5"
                      aria-label={t.unread_count > 9
                        ? `more than 9 unread messages`
                        : `${t.unread_count} unread messages`}
                    >
                      {t.unread_count > 9 ? '9+' : t.unread_count}
                    </span>
                  {/if}
                  {#each myTasks as mt (mt.id)}
                    <!--
                      One amber chip per open task assigned to the viewer.
                      Hover / focus opens a shared popover anchored to the
                      chip's bounding rect that shows the full task title
                      and description. We use a custom popover instead of
                      the native `title` attribute so descriptions of any
                      length are readable, styled to match the rest of the
                      app, and accessible on touch (the chip is also
                      focusable via tab).
                    -->
                    <button
                      type="button"
                      class="chip chip-task ml-0.5 max-w-[200px] truncate"
                      style="pointer-events: auto;"
                      onmouseenter={(e) => showTaskHover(e, mt)}
                      onmouseleave={scheduleHoverClose}
                      onfocus={(e) => showTaskHover(e, mt)}
                      onblur={scheduleHoverClose}
                      onclick={(e) => { e.stopPropagation(); e.preventDefault(); showTaskHover(e, mt); }}
                      aria-label={`Pending task: ${mt.title}`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                           style="flex-shrink:0;">
                        <polyline points="9 11 12 14 22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                      <span class="truncate">{mt.title}</span>
                    </button>
                  {/each}
                </div>

                <h2 class="text-[15px] tracking-tight truncate"
                    class:font-bold={t.unread_count > 0}
                    class:font-semibold={t.unread_count === 0}>
                  {t.title}
                </h2>

                {#if data.isAdmin}
                  <div class="text-fainter text-[11.5px] mt-0.5">from {t.user_email}</div>
                {/if}
              </div>

              <div class="text-right shrink-0 flex flex-col items-end gap-0.5">
                <div class="flex items-center gap-1.5">
                  {#if data.isAdmin}
                    <button
                      type="button"
                      class="archive-btn"
                      aria-label={t.archived_at ? `Restore ticket #${t.id}` : `Archive ticket #${t.id}`}
                      title={t.archived_at ? 'Restore' : 'Archive'}
                      onclick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleArchiveOne(t);
                      }}
                    >
                      <!-- box-archive icon (14px) -->
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="2" y="3" width="20" height="5" rx="1" />
                        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                        <line x1="10" y1="13" x2="14" y2="13" />
                      </svg>
                    </button>
                  {/if}
                  <div class="text-muted num text-[11.5px]">{relTime(t.updated_at)}</div>
                </div>
                <div class="text-fainter text-[11.5px]">
                  {t.message_count} message{t.message_count === 1 ? '' : 's'}
                </div>
                {#if data.isAdmin && seenStatus(t)}
                  {@const s = seenStatus(t)}
                  <div
                    class="eye-row"
                    class:eye-seen={s === 'seen'}
                    class:eye-sent={s === 'sent'}
                    title={seenTooltip(t)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span class="text-[10.5px] font-medium">{s === 'seen' ? 'seen' : 'sent'}</span>
                  </div>
                {/if}
              </div>
            </div>
          </article>
        </li>
      {/each}
    </ul>

    {#if pageCount > 1}
      <nav class="flex items-center justify-center gap-3 mt-6 relative z-[250]" aria-label="Pagination">
        <button type="button" class="btn btn-ghost btn-sm"
                onclick={() => goto(`?${new URLSearchParams({ ...Object.fromEntries(page.url.searchParams), page: String(Math.max(1, data.page - 1)) })}`)}
                disabled={data.page <= 1}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Prev
        </button>
        <span class="text-muted text-xs num">Page {data.page} of {pageCount}</span>
        <button type="button" class="btn btn-sm"
                onclick={() => goto(`?${new URLSearchParams({ ...Object.fromEntries(page.url.searchParams), page: String(Math.min(pageCount, data.page + 1)) })}`)}
                disabled={!data.hasMore}>
          Next
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </nav>
    {/if}
  {/if}
</section>

<!--
  Shared task-hover popover. Renders at viewport-level coordinates derived
  from the hovered chip's bounding rect, with a small `mouseenter` window
  on the popover itself so the cursor can travel from chip to panel
  without the panel disappearing. `pointer-events: auto` on the panel is
  required because the page region around it (the inbox list) does NOT
  have that — the row links have absolute overlays.
-->
{#if hoveredTask}
  <div
    class="fixed z-[300] pointer-events-auto"
    style="left: {Math.max(8, Math.min(hoveredTask.anchorRect.left, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 336))}px;
           top:  {hoveredTask.anchorRect.bottom + 6}px;
           max-width: 320px;"
    onmouseenter={keepHoverOpen}
    onmouseleave={scheduleHoverClose}
    role="tooltip"
    aria-live="polite"
  >
    <div class="glass-strong p-3 rounded-xl shadow-xl">
      <div class="flex items-center gap-1.5 mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider"
           style="color: oklch(0.78 0.16 75);">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        Pending task
      </div>
      <div class="text-sm font-semibold leading-snug" style="color: var(--color-text);">
        {hoveredTask.title}
      </div>
      {#if hoveredTask.description}
        <div class="text-[12.5px] text-muted leading-relaxed mt-2"
             style="white-space: pre-wrap; word-break: break-word;">
          {hoveredTask.description}
        </div>
      {/if}
    </div>
  </div>
{/if}

