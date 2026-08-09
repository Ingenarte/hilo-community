<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	type TimelineEntry = { date: string; ts: number; items: string[] };
	type Props = { data: { entries: TimelineEntry[]; latestTs: number } };
	const { data }: Props = $props();

	function todayBadge(dateStr: string): string {
		const now = new Date();
		const y = now.getFullYear();
		const m = String(now.getMonth() + 1).padStart(2, '0');
		const d = String(now.getDate()).padStart(2, '0');
		return dateStr === `${y}-${m}-${d}` ? 'Today · ' : '';
	}
</script>

<svelte:head>
	<title>Changelog · hilo</title>
</svelte:head>

<section class="max-w-2xl mx-auto px-4 sm:px-6 py-8">
	<header in:fly={{ y: -8, duration: 320, easing: cubicOut }} class="mb-6">
		<div class="eyebrow mb-2">What's new</div>
		<h1 class="text-3xl font-bold tracking-tight">Changelog</h1>
		<p class="text-muted text-sm mt-2 leading-relaxed">
			A short, plain-language log of every user-visible deploy. Internal
			refactors, dependency bumps and test-only changes are not listed
			here — they live in <code class="font-mono text-fainter">git log</code>.
		</p>
	</header>

	{#if data.entries.length === 0}
		<div class="glass p-6 text-center text-fainter text-sm">
			Nothing here yet.
		</div>
	{:else}
		<ol class="space-y-5">
			{#each data.entries as entry, i (entry.date)}
				<li class="glass p-5"
					in:fly={{ y: 6, duration: 280, delay: Math.min(i, 6) * 25, easing: cubicOut }}>
					<div class="eyebrow mb-3 flex items-center gap-2">
						<span style="color: var(--color-accent);">{todayBadge(entry.date)}</span>
						<span>{entry.date}</span>
					</div>
					<ul class="space-y-2">
						{#each entry.items as item}
							<li class="text-sm leading-relaxed flex gap-2">
								<span class="text-fainter shrink-0 mt-1">•</span>
								<span>{item}</span>
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ol>
	{/if}
</section>
