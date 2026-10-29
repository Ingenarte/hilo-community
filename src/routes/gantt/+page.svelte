<script lang="ts">
  import { page } from '$app/state';
  import { saveTicketNav } from '$lib/ticketNav';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import OpenTicketFilters from '$lib/OpenTicketFilters.svelte';
  import { PRIORITY_LABEL, formatRemaining, slaSeconds, slaTone, type Priority } from '$lib/sla';

  type Row = {
    id: number;
    title: string;
    priority: Priority;
    created_at: number;
    sla_due_at: number | null;
    user_email: string;
    projects: string[];
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
      source: 'gantt',
      ids: data.tickets.map((t) => t.id)
    });
  });

  const DAY = 86400;

  // A bar covers the current response window: from the last message (the target
  // restarts with each one) to the deadline. Without a deadline it starts at creation.
  const barStart = (t: Row) =>
    t.sla_due_at != null ? t.sla_due_at - slaSeconds(t.priority) : t.created_at;
  const filtered = $derived(data.filters.userId != null || data.filters.projectId != null);

  let nowSec = $state(Math.floor(Date.now() / 1000));
  onMount(() => {
    const t = setInterval(() => (nowSec = Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  });

  // Each bar runs from when the ticket was opened to its deadline. A ticket
  // without a deadline runs to "now" and is drawn as an open-ended bar.
  // The window is capped so very old tickets do not push "now" off-screen:
  // bars that start before the window are clipped at its left edge.
  const MAX_PAST_DAYS = 14;
  // Always leave room ahead of today so the chart reads as a plan, not just
  // a history; the extra width is reached with horizontal scrolling.
  const MIN_FUTURE_DAYS = 30;
  const MAX_FUTURE_DAYS = 90;
  const range = $derived.by(() => {
    let start = nowSec;
    let end = nowSec + MIN_FUTURE_DAYS * DAY;
    for (const t of data.tickets) {
      start = Math.min(start, barStart(t));
      end = Math.max(end, t.sla_due_at ?? nowSec);
    }
    start = Math.max(start, nowSec - MAX_PAST_DAYS * DAY);
    end = Math.min(end, nowSec + MAX_FUTURE_DAYS * DAY);
    // Snap to whole days so the grid lines fall on midnight (local time).
    const s = new Date(start * 1000);
    s.setHours(0, 0, 0, 0);
    const e = new Date(end * 1000);
    e.setHours(24, 0, 0, 0);
    return { start: s.getTime() / 1000, end: e.getTime() / 1000 };
  });

  const days = $derived.by(() => {
    const out: number[] = [];
    // Step by calendar day, not by 86400 s: a DST change makes one day 23 or
    // 25 hours long, and fixed steps would add a phantom column at the end.
    const d = new Date(range.start * 1000);
    while (d.getTime() / 1000 < range.end) {
      out.push(d.getTime() / 1000);
      d.setDate(d.getDate() + 1);
    }
    return out;
  });

  // Day width adapts to the visible chart width: a short range fills the
  // container, a long one keeps at least MIN_DAY_PX and scrolls horizontally.
  const MIN_DAY_PX = 56;
  let scroller = $state<HTMLDivElement | null>(null);
  let viewWidth = $state(0);
  const dayPx = $derived(Math.max(MIN_DAY_PX, viewWidth > 0 ? viewWidth / days.length : 64));
  const width = $derived(days.length * dayPx);
  const x = (sec: number) => ((sec - range.start) / (range.end - range.start)) * width;
  const clampX = (sec: number) => Math.min(width, Math.max(0, x(sec)));

  // Open the chart with "now" in view (a third from the left edge).
  $effect(() => {
    if (!scroller) return;
    void data.tickets;
    void width;
    scroller.scrollLeft = Math.max(0, x(nowSec) - scroller.clientWidth / 3);
  });

  const dayLabel = (sec: number) =>
    new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  // One color per project, by project order. Hues skip the red/orange/amber
  // band (≈15-90°) reserved for the urgency outlines, and consecutive entries
  // sit far apart on the wheel so neighbouring projects stay distinguishable.
  const PROJECT_HUES = [285, 165, 330, 215, 120, 305, 185, 250, 140, 350, 230, 100];
  const projectColor = $derived(
    new Map(
      data.projects.map((p, i) => [
        p.name,
        `oklch(0.66 0.15 ${PROJECT_HUES[i % PROJECT_HUES.length]})`
      ])
    )
  );
  const NO_PROJECT = 'oklch(0.6 0.02 270)';
  const colorFor = (t: Row) => projectColor.get(t.projects[0] ?? '') ?? NO_PROJECT;

  const legend = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const t of data.tickets) {
      const name = t.projects[0] ?? 'No project';
      if (!seen.has(name)) seen.set(name, colorFor(t));
    }
    return [...seen].map(([name, color]) => ({ name, color }));
  });

  const toneOutline: Record<string, string> = {
    overdue: 'oklch(0.66 0.24 25)',
    critical: 'oklch(0.74 0.2 45)'
  };
</script>

<svelte:head>
  <title>Gantt · hilo</title>
</svelte:head>

<section class="mx-auto px-4 py-6 lg:px-8 lg:py-8">
  <header class="mb-5" in:fly={{ y: -8, duration: 320, easing: cubicOut }}>
    <div class="eyebrow mb-2">Gantt</div>
    <h1 class="text-3xl font-bold tracking-tight">Open tickets on a timeline</h1>
    <p class="text-sm text-muted mt-1.5">
      Each bar runs from the last message to the response deadline (it restarts with every
      message, from either side). The vertical line marks now.
    </p>
  </header>

  <OpenTicketFilters users={data.users} projects={data.projects} filters={data.filters} />

  {#if data.tickets.length === 0}
    <div class="glass py-16 px-6 text-center text-fainter">
      {filtered ? 'No open tickets match these filters.' : 'No open tickets.'}
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-[12.5px]" data-testid="gantt-legend">
      {#each legend as l (l.name)}
        <span class="inline-flex items-center gap-1.5">
          <span class="legend-swatch" style="background:{l.color};"></span>{l.name}
        </span>
      {/each}
      <span class="inline-flex items-center gap-1.5 text-muted">
        <span class="legend-swatch legend-ring" style="--ring:{toneOutline.overdue};"></span>Overdue
      </span>
      <span class="inline-flex items-center gap-1.5 text-muted">
        <span class="legend-swatch legend-ring" style="--ring:{toneOutline.critical};"></span>Due soon
      </span>
      <span class="inline-flex items-center gap-1.5 text-muted">
        <span class="legend-swatch gantt-open" style="--bar:{NO_PROJECT};"></span>No deadline
      </span>
    </div>

    <div class="glass gantt" data-testid="gantt">
      <div class="gantt-labels">
        <div class="gantt-head"></div>
        {#each data.tickets as t (t.id)}
          <a href={`/tickets/${t.id}`} class="gantt-label" title={t.title}>
            <span class="num text-fainter text-[11px]">#{t.id}</span>
            <span class="truncate">{t.title}</span>
          </a>
        {/each}
      </div>

      <div class="gantt-scroll" bind:this={scroller} bind:clientWidth={viewWidth}>
        <div class="gantt-canvas" style="width:{width}px;">
          <div class="gantt-head">
            {#each days as d (d)}
              <div class="gantt-day" style="left:{x(d)}px; width:{dayPx}px;">{dayLabel(d)}</div>
            {/each}
          </div>

          {#each days as d (d)}
            <div class="gantt-grid" style="left:{x(d)}px;"></div>
          {/each}
          <div class="gantt-now" style="left:{x(nowSec)}px;" aria-hidden="true"></div>

          {#each data.tickets as t (t.id)}
            {@const tone = slaTone(t.sla_due_at, t.priority, nowSec)}
            {@const end = t.sla_due_at ?? nowSec}
            <div class="gantt-row" data-ticket-id={t.id} data-tone={tone} data-project={t.projects[0] ?? ''}>
              <!-- Below sm the side labels are hidden; each row carries its own title. -->
              <a
                href={`/tickets/${t.id}`}
                class="gantt-row-label"
                style="width:{viewWidth}px;"
                tabindex="-1"
              >
                <span class="num text-fainter text-[11px]">#{t.id}</span>
                <span class="truncate">{t.title}</span>
              </a>
              <a
                href={`/tickets/${t.id}`}
                class="gantt-bar"
                class:gantt-open={t.sla_due_at == null}
                class:gantt-clipped={barStart(t) < range.start}
                style="left:{clampX(barStart(t))}px; width:{Math.max(6, clampX(end) - clampX(barStart(t)))}px; --bar:{colorFor(t)};{toneOutline[tone] ? ` box-shadow: 0 0 0 2px ${toneOutline[tone]};` : ''}"
                title={`#${t.id} ${t.title} · ${PRIORITY_LABEL[t.priority]} · ${formatRemaining(t.sla_due_at, nowSec)}${data.isAdmin ? ` · ${t.user_email}` : ''}${t.projects.length ? ` · ${t.projects.join(', ')}` : ''}`}
                aria-label={`Ticket #${t.id}: ${t.title}, ${formatRemaining(t.sla_due_at, nowSec)}`}
              ></a>
            </div>
          {/each}
        </div>
      </div>
    </div>

    {#if data.hasMore}
      <p class="text-[12px] text-fainter mt-3">
        Showing the first {data.tickets.length} of {data.total} open tickets.
      </p>
    {/if}
  {/if}
</section>

<style>
  .gantt {
    display: flex;
    overflow: hidden;
    padding: 0;
    --row: 36px;
    --head: 32px;
  }
  .gantt-labels {
    flex: 0 0 auto;
    width: clamp(180px, 28vw, 280px);
    border-right: 1px solid var(--glass-border);
  }
  .gantt-head {
    height: var(--head);
    position: relative;
    border-bottom: 1px solid var(--glass-border);
  }
  .gantt-label {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--row);
    padding: 0 10px;
    font-size: 13px;
    min-width: 0;
  }
  .gantt-label:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.04));
  }
  .gantt-scroll {
    flex: 1 1 auto;
    overflow-x: auto;
    min-width: 0;
  }
  .gantt-canvas {
    position: relative;
  }
  .gantt-day {
    position: absolute;
    top: 0;
    height: var(--head);
    display: flex;
    align-items: center;
    padding-left: 6px;
    font-size: 11px;
    color: var(--color-muted);
    white-space: nowrap;
  }
  .gantt-grid {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--glass-border);
  }
  .gantt-now {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: oklch(0.72 0.23 25);
    z-index: 2;
    pointer-events: none;
  }
  .gantt-row {
    position: relative;
    height: var(--row);
  }
  .gantt-bar {
    position: absolute;
    top: 9px;
    height: 18px;
    border-radius: 6px;
    background: var(--bar);
    opacity: 0.9;
  }
  .gantt-bar:hover,
  .gantt-bar:focus-visible {
    opacity: 1;
    outline: 2px solid var(--bar);
    outline-offset: 2px;
  }
  .legend-swatch {
    display: inline-block;
    width: 14px;
    height: 10px;
    border-radius: 3px;
  }
  .legend-ring {
    background: transparent;
    box-shadow: 0 0 0 2px var(--ring);
  }
  .gantt-clipped {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .gantt-row-label {
    display: none;
  }
  @media (max-width: 639.98px) {
    .gantt {
      --row: 52px;
    }
    .gantt-labels {
      display: none;
    }
    .gantt-row-label {
      position: sticky;
      left: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 6px;
      height: 22px;
      padding: 0 10px;
      /* Sit above the "now" line so it never crosses the title text. */
      background: color-mix(in oklch, var(--color-bg) 82%, transparent);
      font-size: 12.5px;
      min-width: 0;
    }
    .gantt-bar {
      top: 26px;
      height: 16px;
    }
  }
  .gantt-open {
    background: repeating-linear-gradient(
      45deg,
      var(--bar) 0 6px,
      transparent 6px 10px
    );
    border: 1px solid var(--bar);
  }
</style>
