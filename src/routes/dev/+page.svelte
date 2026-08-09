<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { fmtBytes } from '$lib/format';

  type Props = {
    data: {
      counts: Record<string, number>;
      env: Record<string, string>;
      memory: NodeJS.MemoryUsage;
    };
  };

  const { data }: Props = $props();

</script>

<section class="max-w-6xl mx-auto px-6 py-8 lg:px-8">
  <header in:fly={{ y: -8, duration: 320, easing: cubicOut }} class="mb-6">
    <div class="eyebrow mb-2">Operator</div>
    <h1 class="text-3xl font-bold tracking-tight mb-1.5">Dev panel</h1>
    <p class="text-muted text-sm font-mono">
      Counters, environment + memory snapshot. Lit only when
      <code class="md-code">HILO_DEV_PANEL=1</code>.
    </p>
  </header>

  <div class="grid gap-5 lg:grid-cols-2">
    <section class="glass p-5">
      <div class="label mb-3">Counts</div>
      <dl class="grid grid-cols-2 gap-y-1.5 text-sm">
        {#each Object.entries(data.counts) as [k, v]}
          <dt class="text-muted">{k}</dt>
          <dd class="font-mono text-right">{v}</dd>
        {/each}
      </dl>
    </section>

    <section class="glass p-5">
      <div class="label mb-3">Memory (Node)</div>
      <dl class="grid grid-cols-2 gap-y-1.5 text-sm">
        <dt class="text-muted">RSS</dt>
        <dd class="font-mono text-right">{fmtBytes(data.memory.rss)}</dd>
        <dt class="text-muted">heap used</dt>
        <dd class="font-mono text-right">{fmtBytes(data.memory.heapUsed)}</dd>
        <dt class="text-muted">heap total</dt>
        <dd class="font-mono text-right">{fmtBytes(data.memory.heapTotal)}</dd>
        <dt class="text-muted">external</dt>
        <dd class="font-mono text-right">{fmtBytes(data.memory.external)}</dd>
      </dl>
    </section>

    <section class="glass p-5 lg:col-span-2">
      <div class="label mb-3">Environment</div>
      <dl class="grid grid-cols-[180px_1fr] gap-y-1.5 text-sm">
        {#each Object.entries(data.env) as [k, v]}
          <dt class="text-muted font-mono text-[12.5px]">{k}</dt>
          <dd class="font-mono text-right truncate text-[12.5px]" title={v}>{v}</dd>
        {/each}
      </dl>
    </section>
  </div>
</section>
