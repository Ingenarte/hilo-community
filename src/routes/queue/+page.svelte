<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import BulkActionsBar from '$lib/BulkActionsBar.svelte';
  import { saveTicketNav } from '$lib/ticketNav';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import OpenTicketFilters from '$lib/OpenTicketFilters.svelte';
  import {
    PRIORITY_LABEL,
    SLA_HOURS,
    formatRemaining,
    slaTone,
    type Priority
  } from '$lib/sla';

  type Row = {
    id: number;
    title: string;
    priority: Priority;
    priority_reason: string | null;
    sla_due_at: number | null;
    user_email: string;
    projects: string[];
    unread_count: number;
  };

  type Props = {
    data: {
      isAdmin: boolean;
      tickets: Row[];
      total: number;
      hasMore: boolean;
      users: Array<{ id: number; email: string }>;
      projects: Array<{ id: number; name: string }>;
      filters: { userId: number | null; projectId: number | null };
    };
  };
  const { data }: Props = $props();

  // Remember this list's order so a ticket opened from it can offer
  // previous / next without going back to the list.
  $effect(() => {
    saveTicketNav({
      href: page.url.pathname + page.url.search,
      source: 'queue',
      ids: data.tickets.map((t) => t.id)
    });
  });

  // Selection and bulk actions (admins only, same bar as the inbox).
  let selected = $state<Set<number>>(new Set());
  let bulkNotice = $state<string | null>(null);
  let bulkNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  const allSelected = $derived(data.tickets.length > 0 && selected.size === data.tickets.length);

  // Drop ids that left the list (filters changed, tickets closed elsewhere).
  $effect(() => {
    const present = new Set(data.tickets.map((t) => t.id));
    if ([...selected].some((id) => !present.has(id))) {
      selected = new Set([...selected].filter((id) => present.has(id)));
    }
  });

  function toggleAll(checked: boolean) {
    selected = checked ? new Set(data.tickets.map((t) => t.id)) : new Set();
  }
  function toggleOne(id: number) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    selected = next;
  }
  async function onBulkDone(info: { message: string }) {
    selected = new Set();
    bulkNotice = info.message;
    if (bulkNoticeTimer) clearTimeout(bulkNoticeTimer);
    bulkNoticeTimer = setTimeout(() => (bulkNotice = null), 6000);
    await invalidateAll();
  }

  const filtered = $derived(data.filters.userId != null || data.filters.projectId != null);

  let nowSec = $state(Math.floor(Date.now() / 1000));
  onMount(() => {
    const t = setInterval(() => (nowSec = Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  });

  const overdue = $derived(
    data.tickets.filter((t) => t.sla_due_at != null && t.sla_due_at <= nowSec).length
  );
  const dueSoon = $derived(
    data.tickets.filter(
      (t) => t.sla_due_at != null && t.sla_due_at > nowSec && t.sla_due_at - nowSec <= 24 * 3600
    ).length
  );
</script>

<svelte:head>
  <title>Queue · hilo</title>
</svelte:head>

<section class="max-w-6xl mx-auto px-4 py-6 lg:px-8 lg:py-8"
         style:padding-bottom={data.isAdmin && selected.size > 0
           ? 'calc(10rem + env(safe-area-inset-bottom, 0px))'
           : undefined}>
  <header class="mb-5" in:fly={{ y: -8, duration: 320, easing: cubicOut }}>
    <div class="eyebrow mb-2">Queue</div>
    <h1 class="text-3xl font-bold tracking-tight">Open tickets by deadline</h1>
    <p class="text-sm text-muted mt-1.5">
      Soonest deadline first. The target restarts with every message, from either side:
      urgent {SLA_HOURS.urgent}h, high {SLA_HOURS.high}h, normal {SLA_HOURS.normal}h,
      low {SLA_HOURS.low}h.
    </p>
  </header>

  <div class="flex flex-wrap items-center gap-2 mb-4 text-sm" data-testid="queue-summary">
    <span class="chip">{data.total} open</span>
    <span class="chip" class:chip-urgent={overdue > 0}>{overdue} overdue</span>
    <span class="chip" class:chip-high={dueSoon > 0}>{dueSoon} due in 24h</span>
    {#if data.isAdmin && data.tickets.length > 0}
      <label class="ml-auto inline-flex items-center gap-2 text-muted select-none cursor-pointer">
        <input type="checkbox" checked={allSelected}
               onchange={(e) => toggleAll((e.currentTarget as HTMLInputElement).checked)}
               data-testid="queue-select-all" />
        Select all
      </label>
    {/if}
  </div>

  {#if data.isAdmin}
    <BulkActionsBar
      ids={[...selected]}
      mode="queue"
      ondone={onBulkDone}
      onclear={() => (selected = new Set())}
    />
  {/if}

  {#if bulkNotice}
    <p class="glass mb-3 px-4 py-2.5 text-sm" role="status" data-testid="bulk-notice">{bulkNotice}</p>
  {/if}

  <OpenTicketFilters users={data.users} projects={data.projects} filters={data.filters} />

  {#if data.tickets.length === 0}
    <div class="glass py-16 px-6 text-center text-fainter">
      {filtered ? 'No open tickets match these filters.' : 'No open tickets.'}
    </div>
  {:else}
    <ul class="glass inbox-list anim-fade-in" class:has-selection={selected.size > 0} data-testid="queue-list">
      {#each data.tickets as t (t.id)}
        {@const tone = slaTone(t.sla_due_at, t.priority, nowSec)}
        <li class="inbox-row" class:is-selected={selected.has(t.id)}>
          <article
            class="relative px-4 py-3.5 overflow-hidden"
            class:is-selected={selected.has(t.id)}
            data-ticket-id={t.id}
            data-tone={tone}
          >
            {#if tone === 'overdue' || tone === 'critical'}
              <span class="absolute left-0 top-0 bottom-0 w-[3px] pointer-events-none"
                    style="background: {tone === 'overdue' ? 'oklch(0.62 0.23 25)' : 'oklch(0.7 0.2 45)'};"></span>
            {/if}
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
                  <span class="num text-fainter text-[11px]">#{t.id}</span>
                  <span class="chip chip-{t.priority}" data-testid="tier-chip">
                    {PRIORITY_LABEL[t.priority]} · {SLA_HOURS[t.priority]}h
                  </span>
                  {#each t.projects as p}
                    <span class="chip chip-project">{p}</span>
                  {/each}
                  {#if t.unread_count > 0}
                    <span
                      class="badge-unread ml-0.5"
                      aria-label={t.unread_count > 9
                        ? 'more than 9 unread messages'
                        : `${t.unread_count} unread messages`}
                    >
                      {t.unread_count > 9 ? '9+' : t.unread_count}
                    </span>
                  {/if}
                </div>
                <h2 class="text-[15px] tracking-tight truncate font-semibold">{t.title}</h2>
                {#if data.isAdmin}
                  <div class="text-fainter text-[11.5px] mt-0.5">from {t.user_email}</div>
                {/if}
                {#if t.priority === 'urgent' && t.priority_reason}
                  <div class="text-[12px] mt-1 truncate" style="color: var(--color-danger);">
                    {t.priority_reason}
                  </div>
                {/if}
              </div>

              <div class="text-right shrink-0">
                <div class="num text-[13px] font-medium sla-{tone}" data-testid="remaining">
                  {formatRemaining(t.sla_due_at, nowSec)}
                </div>
              </div>
            </div>
          </article>
        </li>
      {/each}
    </ul>
    {#if data.hasMore}
      <p class="text-fainter text-xs mt-3 text-center">
        Showing the first {data.tickets.length} of {data.total} open tickets.
      </p>
    {/if}
  {/if}
</section>
