<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Entry = {
    id: number;
    created_at: number;
    actor_id: number | null;
    actor_email: string | null;
    action: string;
    target: string | null;
    detail_json: string | null;
  };

  type Props = {
    data: {
      entries: Entry[];
      total: number;
      page: number;
      perPage: number;
      filter: { action: string };
    };
  };

  const { data }: Props = $props();

  let action = $state('');
  $effect.pre(() => { action = data.filter.action; });

  let timer: ReturnType<typeof setTimeout> | null = null;
  function onInput(v: string) {
    action = v;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const url = new URL($page.url);
      if (v) url.searchParams.set('action', v); else url.searchParams.delete('action');
      url.searchParams.delete('page');
      goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    }, 220);
  }

  const pageCount = $derived(Math.max(1, Math.ceil(data.total / data.perPage)));

  function fmtTime(unix: number) {
    const d = new Date(unix * 1000);
    return d.toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
</script>

<section class="max-w-6xl mx-auto px-6 py-8 lg:px-8">
  <header class="mb-5" in:fly={{ y: -8, duration: 320, easing: cubicOut }}>
    <div class="eyebrow mb-2">Admin</div>
    <h1 class="text-3xl font-bold tracking-tight">Audit log</h1>
  </header>

  <div class="glass p-3 flex items-center gap-3 mb-4">
    <input class="input max-w-xs font-mono text-[12.5px]"
           placeholder="Filter by action (e.g. ticket.created)"
           value={action}
           oninput={(e) => onInput((e.target as HTMLInputElement).value)} />
    <span class="ml-auto text-fainter font-mono text-xs">{data.total} entries</span>
  </div>

  <!-- Desktop table: visible at md+ (≥768px) -->
  <div class="glass overflow-hidden hidden md:block">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-fainter text-xs uppercase tracking-wider"
              style="background: oklch(0 0 0 / 0.15);">
            <th class="font-semibold py-2.5 pl-4 pr-3">When</th>
            <th class="font-semibold py-2.5 pr-3">Actor</th>
            <th class="font-semibold py-2.5 pr-3">Action</th>
            <th class="font-semibold py-2.5 pr-3">Target</th>
            <th class="font-semibold py-2.5 pr-4">Detail</th>
          </tr>
        </thead>
        <tbody>
          {#each data.entries as e}
            <tr style="border-top: 1px solid var(--glass-border);">
              <td class="py-2 pl-4 pr-3 font-mono text-muted text-xs whitespace-nowrap">{fmtTime(e.created_at)}</td>
              <td class="py-2 pr-3 font-mono text-[12.5px] truncate max-w-[200px]">{e.actor_email ?? '—'}</td>
              <td class="py-2 pr-3"><code class="font-mono text-[12.5px]">{e.action}</code></td>
              <td class="py-2 pr-3"><code class="font-mono text-fainter text-xs">{e.target ?? '—'}</code></td>
              <td class="py-2 pr-4">
                <code class="font-mono text-fainter text-[11px] block truncate max-w-[280px]"
                      title={e.detail_json ?? ''}>{e.detail_json ?? ''}</code>
              </td>
            </tr>
          {/each}
          {#if data.entries.length === 0}
            <tr><td colspan="5" class="py-12 text-center text-fainter">No entries.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Mobile cards: visible below md (<768px) -->
  <ul class="md:hidden space-y-3">
    {#each data.entries as e}
      <li class="glass p-3 rounded-xl">
        <div class="flex items-start justify-between gap-2 mb-1">
          <code class="font-mono text-sm font-medium">{e.action}</code>
          <span class="text-xs text-muted font-mono shrink-0">{fmtTime(e.created_at)}</span>
        </div>
        <div class="text-xs text-muted truncate mb-2">{e.actor_email ?? '—'}</div>
        {#if e.target}
          <div class="text-xs font-mono text-fainter mb-2 truncate">{e.target}</div>
        {/if}
        {#if e.detail_json}
          <!-- VP-017: collapsible detail instead of truncated tooltip -->
          <details class="text-xs">
            <summary class="cursor-pointer text-fainter select-none">Detail</summary>
            <pre class="mt-1 font-mono text-[11px] whitespace-pre-wrap break-all max-h-32 overflow-y-auto p-2 rounded"
                 style="background: oklch(0 0 0 / 0.2);">{e.detail_json}</pre>
          </details>
        {/if}
      </li>
    {/each}
    {#if data.entries.length === 0}
      <li class="glass p-6 text-center text-fainter">No entries.</li>
    {/if}
  </ul>

  {#if pageCount > 1}
    <nav class="flex items-center justify-center gap-3 mt-5" aria-label="Pagination">
      <a class="btn btn-ghost"
         href={`?${new URLSearchParams({ ...Object.fromEntries($page.url.searchParams), page: String(Math.max(1, data.page - 1)) })}`}>
        ← Prev
      </a>
      <span class="text-muted text-xs font-mono">Page {data.page} of {pageCount}</span>
      <a class="btn btn-ghost"
         href={`?${new URLSearchParams({ ...Object.fromEntries($page.url.searchParams), page: String(Math.min(pageCount, data.page + 1)) })}`}>
        Next →
      </a>
    </nav>
  {/if}
</section>
