<script lang="ts">
	/**
	 * Bell button + "What's new" dropdown for the navbar.
	 *
	 * The button sits next to Refresh in `+layout.svelte`. A small accent
	 * dot lights up in the top-right corner of the bell when there is at
	 * least one timeline entry the current viewer has not seen yet.
	 *
	 * Read state is per-browser, kept in localStorage as a unix-seconds
	 * timestamp. The bell compares the timeline's latest entry timestamp
	 * (from `/api/timeline`) against the stored value to decide whether
	 * to show the dot. Opening the dropdown advances the stored value to
	 * the latest, so the dot clears on every device the user opens.
	 *
	 * Why not the DB? The "have I seen this changelog yet" question is
	 * low-stakes — if a user sees the dot once on each of their devices
	 * it is not a bug. localStorage saves a schema migration and an
	 * extra endpoint. Upgrade to DB tracking only if cross-device
	 * fidelity becomes important.
	 */
	import { onMount, tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	type TimelineEntry = { date: string; ts: number; items: string[] };
	type TimelinePayload = { entries: TimelineEntry[]; latestTs: number };

	const SEEN_KEY = 'hilo.timeline.last_seen_ts';

	let payload = $state<TimelinePayload | null>(null);
	let loadError = $state<string | null>(null);
	let open = $state(false);
	let triggerRef = $state<HTMLButtonElement | null>(null);
	let closeRef = $state<HTMLButtonElement | null>(null);
	let lastSeenTs = $state(0);

	const hasUnseen = $derived(
		payload != null && payload.latestTs > 0 && payload.latestTs > lastSeenTs
	);

	function readSeen(): number {
		if (typeof localStorage === 'undefined') return 0;
		const raw = localStorage.getItem(SEEN_KEY);
		const n = raw == null ? 0 : Number(raw);
		return Number.isFinite(n) ? n : 0;
	}

	function writeSeen(ts: number) {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(SEEN_KEY, String(ts));
		} catch {
			// quota / private mode — fall through, the dot will reappear next session
		}
	}

	async function fetchPayload() {
		try {
			const r = await fetch('/api/timeline', { credentials: 'same-origin' });
			if (!r.ok) {
				loadError = `HTTP ${r.status}`;
				return;
			}
			payload = (await r.json()) as TimelinePayload;
			loadError = null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load';
		}
	}

	async function openPanel() {
		open = true;
		await tick();
		closeRef?.focus();
		if (payload && payload.latestTs > 0) {
			lastSeenTs = payload.latestTs;
			writeSeen(payload.latestTs);
		}
	}

	function closePanel() {
		open = false;
		triggerRef?.focus();
	}

	onMount(() => {
		lastSeenTs = readSeen();
		fetchPayload();
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape' && open) {
				e.stopPropagation();
				closePanel();
			}
		}
		document.addEventListener('keydown', onKeydown, { capture: true });
		return () => document.removeEventListener('keydown', onKeydown, { capture: true });
	});

	function todayBadge(dateStr: string): string {
		// `YYYY-MM-DD` of "today" in the viewer's local timezone. Cheap and
		// good enough for a "Today" label — exact timezone subtleties on
		// the changelog do not matter.
		const now = new Date();
		const y = now.getFullYear();
		const m = String(now.getMonth() + 1).padStart(2, '0');
		const d = String(now.getDate()).padStart(2, '0');
		const today = `${y}-${m}-${d}`;
		return dateStr === today ? 'Today · ' : '';
	}
</script>

<button
	bind:this={triggerRef}
	type="button"
	class="btn btn-ghost relative"
	style="height:40px; width:40px; padding:0;"
	aria-label={hasUnseen ? "What's new — updates available" : "What's new"}
	aria-haspopup="dialog"
	aria-expanded={open}
	title="What's new"
	onclick={openPanel}
>
	<!--
		File-text glyph (release-notes / changelog metaphor). Replaces the
		earlier bell icon, which was confusing because it overlaps with
		the "new messages" notification language used elsewhere in the
		app. A literal document with line marks reads as "what changed"
		rather than "you have a new message."
	-->
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
		 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		<polyline points="14 2 14 8 20 8" />
		<line x1="8" y1="13" x2="14" y2="13" />
		<line x1="8" y1="17" x2="16" y2="17" />
	</svg>
	{#if hasUnseen}
		<span
			aria-hidden="true"
			style="position: absolute; top: 8px; right: 8px; width: 8px; height: 8px;
			       border-radius: 9999px;
			       background: linear-gradient(135deg, var(--color-accent), var(--color-accent-2));
			       box-shadow: 0 0 0 2px var(--color-bg-deep), 0 0 8px var(--color-accent);"
		></span>
	{/if}
</button>

{#if open}
	<div
		class="fixed inset-0 z-[150]"
		role="dialog"
		aria-modal="true"
		aria-labelledby="timeline-dialog-title"
		transition:fade={{ duration: 140 }}
	>
		<button
			type="button"
			class="absolute inset-0 bg-black/55 border-0 p-0 w-full h-full cursor-default"
			aria-label="Close"
			tabindex="-1"
			onclick={closePanel}
		></button>

		<div
			class="glass-strong absolute right-3 top-16 w-[360px] max-w-[calc(100vw-1.5rem)]
			       max-h-[min(60dvh,520px)] flex flex-col"
			style="padding-top: calc(0.875rem + env(safe-area-inset-top, 0px));"
			transition:fly={{ y: -6, duration: 200, easing: cubicOut }}
		>
			<div class="flex items-center justify-between px-4 pb-2">
				<h2 id="timeline-dialog-title" class="text-sm font-semibold tracking-tight">
					What's new
				</h2>
				<button
					bind:this={closeRef}
					type="button"
					class="btn btn-ghost"
					style="height: 28px; width: 28px; padding: 0; border-radius: 999px;"
					aria-label="Close"
					onclick={closePanel}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
						 stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="overflow-y-auto thin-scroll px-4 pb-4 flex-1">
				{#if loadError}
					<p class="text-fainter text-xs py-4">Could not load updates ({loadError}).</p>
				{:else if payload == null}
					<p class="text-fainter text-xs py-4">Loading…</p>
				{:else if payload.entries.length === 0}
					<p class="text-fainter text-xs py-4">Nothing here yet.</p>
				{:else}
					<ul class="space-y-3">
						{#each payload.entries as entry}
							<li>
								<div class="text-fainter text-[10.5px] font-mono uppercase tracking-wider mb-1">
									{todayBadge(entry.date)}{entry.date}
								</div>
								<ul class="space-y-1.5">
									{#each entry.items as item}
										<li class="text-[12.5px] leading-snug" style="color: var(--color-text);">
											<span class="text-fainter" aria-hidden="true">·</span>
											{item}
										</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="px-4 py-2 border-t flex items-center justify-end"
				 style="border-color: var(--glass-border);">
				<a href="/changelog" class="link text-xs" onclick={closePanel}>
					View full changelog →
				</a>
			</div>
		</div>
	</div>
{/if}
