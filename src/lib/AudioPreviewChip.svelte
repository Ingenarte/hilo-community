<script lang="ts">
	/**
	 * Inline preview chip for an audio File in the composer's pending-files
	 * row. Renders a properly-sized `<audio controls>` so the user can
	 * listen to their voice note before pressing Send.
	 *
	 * Why a dedicated component instead of inlining:
	 *
	 * 1. Blob-URL lifecycle. Inlining `URL.createObjectURL(file)` via
	 *    `{@const}` inside an `{#each}` recreates the URL on every reactive
	 *    re-render and never revokes the previous handles. Each component
	 *    instance owns one URL through an `$effect` and revokes it on
	 *    teardown.
	 *
	 * 2. Sizing. The native audio controls need ~36-44 px of vertical
	 *    space to render hit-testable play / scrubber / volume controls.
	 *    The earlier 28 px chip squashed the controls beyond use — they
	 *    were drawn but unclickable in Chrome and invisible in Safari.
	 *    A fixed 36 px component height fixes the regression and lets the
	 *    composer surrounding layout stay tight.
	 *
	 * 3. Error visibility. If the recorded mime is not playable in the
	 *    viewer's browser (Safari + webm/opus on older versions) we
	 *    surface a small "Cannot preview" hint instead of showing a dead
	 *    control.
	 */
	import { fmtBytes } from '$lib/format';
	import { onDestroy, untrack } from 'svelte';

	type Props = { file: File; onRemove: () => void };
	const { file, onRemove }: Props = $props();

	// `untrack` tells the Svelte compiler this read is intentionally
	// non-reactive. The file prop never changes after mount; we want
	// exactly one blob URL created synchronously so the <audio src> is
	// non-empty on the first render (avoids the onerror → cannotPlay race).
	// Previously written as `URL.createObjectURL(file)` which produced a
	// Svelte warning about capturing the initial value of a prop.
	const url = untrack(() => URL.createObjectURL(file));

	let cannotPlay = $state(false);
	let audioEl: HTMLAudioElement | null = $state(null);

	onDestroy(() => URL.revokeObjectURL(url));

	function onError(e: Event) {
		// Log the underlying mediaError so prod issues are debuggable. The
		// previous silent flip-to-fallback hid the real cause when the
		// chip refused to play even on known-good WAV blobs.
		const audio = e.currentTarget as HTMLAudioElement;
		const err = audio.error;
		console.error('[audio-preview] error', {
			code: err?.code,
			message: err?.message,
			networkState: audio.networkState,
			readyState: audio.readyState,
			src: audio.currentSrc || audio.src
		});
		cannotPlay = true;
	}
</script>

<div class="inline-flex items-center gap-2 max-w-full">
	{#if !cannotPlay}
		<audio
			bind:this={audioEl}
			controls
			preload="metadata"
			src={url}
			onerror={onError}
			style="height: 36px; width: 240px; max-width: 100%;"
			aria-label={`Preview ${file.name}`}
		></audio>
	{:else}
		<span class="font-medium text-xs">{file.name}</span>
		<span class="text-fainter text-[10px]">(cannot preview)</span>
	{/if}
	<span class="text-fainter font-mono text-[11px] shrink-0">{fmtBytes(file.size)}</span>
	<button
		type="button"
		class="text-fainter hover:text-danger shrink-0"
		style="font-size: 14px; line-height: 1; padding: 2px 4px;"
		aria-label={`Remove ${file.name}`}
		onclick={onRemove}>×</button
	>
</div>
