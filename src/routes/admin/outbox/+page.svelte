<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Row = {
    id: number;
    to_email: string;
    subject: string;
    send_after: number;
    attempts: number;
    sent_at: number | null;
    error: string | null;
  };
  type Counts = { all: number; pending: number; sent: number; failed: number };

  type Props = { data: { rows: Row[]; counts: Counts; status: string; page: number; perPage: number; total: number } };
  const { data }: Props = $props();

  const pageCount = $derived(Math.max(1, Math.ceil(data.total / data.perPage)));

  const tabs = ['all', 'pending', 'failed', 'sent'] as const;

  function setStatus(s: string) {
    const url = new URL($page.url);
    if (s === 'all') url.searchParams.delete('status');
    else url.searchParams.set('status', s);
    // Reset to page 1 when switching filter tabs.
    url.searchParams.delete('page');
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  async function retry(id: number) {
    await fetch('/api/admin/outbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, op: 'retry' })
    });
    await invalidateAll();
  }

  async function cancel(id: number) {
    if (!confirm('Cancel this outbound email?')) return;
    await fetch('/api/admin/outbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, op: 'cancel' })
    });
    await invalidateAll();
  }

  function fmtTime(unix: number | null) {
    if (!unix) return '—';
    return new Date(unix * 1000).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
</script>

<section class="max-w-6xl mx-auto px-6 py-8 lg:px-8">
  <header in:fly={{ y: -8, duration: 320, easing: cubicOut }} class="mb-5">
    <div class="eyebrow mb-2">Admin</div>
    <h1 class="text-3xl font-bold tracking-tight">Email outbox</h1>
  </header>

  <!-- Filter tabs: flex-wrap so they wrap on mobile instead of overflowing (VP-016) -->
  <div class="glass p-3 flex flex-wrap gap-2 mb-4">
    {#each tabs as t}
      {@const active = data.status === t || (t === 'all' && !data.status)}
      <button type="button" class="chip {active ? 'chip-open' : ''}" style="height:36px; padding: 0 14px; cursor: pointer;"
              onclick={() => setStatus(t)}>
        <span class="capitalize">{t}</span>
        <span class="font-mono">{data.counts[t]}</span>
      </button>
    {/each}
  </div>

  <!-- Desktop table: visible at md+ (≥768px) -->
  <div class="glass overflow-hidden hidden md:block">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-fainter text-xs uppercase tracking-wider"
              style="background: oklch(0 0 0 / 0.15);">
            <th class="font-semibold py-2.5 pl-4 pr-3">#</th>
            <th class="font-semibold py-2.5 pr-3">To</th>
            <th class="font-semibold py-2.5 pr-3">Subject</th>
            <th class="font-semibold py-2.5 pr-3">Send after</th>
            <th class="font-semibold py-2.5 pr-3 text-right">Attempts</th>
            <th class="font-semibold py-2.5 pr-3">Sent</th>
            <th class="font-semibold py-2.5 pr-3">Error</th>
            <th class="font-semibold py-2.5 pr-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as r}
            <tr style="border-top: 1px solid var(--glass-border);">
              <td class="py-2 pl-4 pr-3 font-mono text-fainter text-xs">{r.id}</td>
              <td class="py-2 pr-3 truncate max-w-[200px] text-[12.5px]" title={r.to_email}>{r.to_email}</td>
              <td class="py-2 pr-3 truncate max-w-[280px]" title={r.subject}>{r.subject}</td>
              <td class="py-2 pr-3 font-mono text-fainter text-xs">{fmtTime(r.send_after)}</td>
              <td class="py-2 pr-3 text-right font-mono">{r.attempts}</td>
              <td class="py-2 pr-3 font-mono text-fainter text-xs">{fmtTime(r.sent_at)}</td>
              <td class="py-2 pr-3 truncate max-w-[200px] text-[11px]"
                  style="color: var(--color-danger);">
                {r.error ?? ''}
              </td>
              <td class="py-2 pr-4 text-right whitespace-nowrap">
                {#if !r.sent_at}
                  <button class="btn btn-ghost h-9 px-3 text-xs mr-1" onclick={() => retry(r.id)}>Retry</button>
                  <button class="btn btn-ghost h-9 px-3 text-xs" onclick={() => cancel(r.id)}>Cancel</button>
                {/if}
              </td>
            </tr>
          {/each}
          {#if data.rows.length === 0}
            <tr><td colspan="8" class="py-12 text-center text-fainter">No messages.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Mobile cards: visible below md (<768px) -->
  <ul class="md:hidden space-y-3">
    {#each data.rows as r}
      <li class="glass p-3 rounded-xl">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="min-w-0 flex-1">
            <div class="font-medium text-sm truncate">{r.subject}</div>
            <div class="text-xs text-muted truncate">→ {r.to_email}</div>
          </div>
          <span class="chip shrink-0 {r.sent_at ? 'chip-open' : r.error ? 'chip-closed' : 'chip-pending'}">
            {r.sent_at ? 'sent' : r.error ? 'failed' : 'pending'}
          </span>
        </div>
        <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted mb-3">
          <div><dt class="opacity-60">Attempts</dt><dd class="font-mono">{r.attempts}</dd></div>
          <div><dt class="opacity-60">Sent at</dt><dd class="font-mono">{fmtTime(r.sent_at)}</dd></div>
          {#if r.error}
            <div class="col-span-2">
              <dt class="opacity-60">Error</dt>
              <dd class="font-mono text-[11px] break-all" style="color: var(--color-danger);">{r.error}</dd>
            </div>
          {/if}
        </dl>
        {#if !r.sent_at}
          <div class="flex gap-2 pt-2 border-t" style="border-color: var(--glass-border);">
            <button class="btn btn-ghost h-9 flex-1 text-xs" onclick={() => retry(r.id)}>Retry</button>
            <button class="btn btn-ghost h-9 flex-1 text-xs" onclick={() => cancel(r.id)}>Cancel</button>
          </div>
        {/if}
      </li>
    {/each}
    {#if data.rows.length === 0}
      <li class="glass p-6 text-center text-fainter">No messages.</li>
    {/if}
  </ul>

  {#if pageCount > 1}
    <nav class="flex items-center justify-center gap-3 mt-5" aria-label="Pagination">
      <a class="btn btn-ghost" style="height:36px;"
         href={`?${new URLSearchParams({ ...Object.fromEntries($page.url.searchParams), page: String(Math.max(1, data.page - 1)) })}`}>
        ← Prev
      </a>
      <span class="text-muted text-xs font-mono">Page {data.page} of {pageCount}</span>
      <a class="btn btn-ghost" style="height:36px;"
         href={`?${new URLSearchParams({ ...Object.fromEntries($page.url.searchParams), page: String(Math.min(pageCount, data.page + 1)) })}`}>
        Next →
      </a>
    </nav>
  {/if}
</section>
