<script lang="ts">
	/**
	 * Inline preview chip for a video File in the composer's
	 * pending-files row. Mirrors AudioPreviewChip in lifecycle (blob URL
	 * created synchronously, revoked on destroy) but renders a
	 * `<video controls>` with a thumbnail-friendly aspect ratio so the
	 * user can confirm the take BEFORE pressing Send.
	 *
	 * Same race fix as the audio chip: the blob URL is created in the
	 * script body, not an `$effect`, so the video element never sees
	 * an empty `src` on first render.
	 */
	import { fmtBytes } from '$lib/format';
	import { onDestroy, untrack } from 'svelte';

	type Props = { file: File; onRemove: () => void };
	const { file, onRemove }: Props = $props();

	// `untrack` tells the Svelte compiler this read is intentionally
	// non-reactive. The file prop never changes after mount; we want
	// exactly one blob URL created synchronously so the <video src> is
	// non-empty on the first render (avoids the onerror → cannotPlay race).
	const url = untrack(() => URL.createObjectURL(file));
	let cannotPlay = $state(false);

	onDestroy(() => URL.revokeObjectURL(url));

	function onError(e: Event) {
		const v = e.currentTarget as HTMLVideoElement;
		const err = v.error;
		console.error('[video-preview] error', {
			code: err?.code,
			message: err?.message,
			networkState: v.networkState,
			readyState: v.readyState,
			src: v.currentSrc || v.src
		});
		cannotPlay = true;
	}
</script>

<div class="inline-flex items-start gap-2 max-w-full">
	{#if !cannotPlay}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			controls
			preload="metadata"
			src={url}
			onerror={onError}
			style="height: 120px; width: 200px; max-width: 100%;
			       border-radius: 8px; background: black; object-fit: contain;"
			aria-label={`Preview ${file.name}`}
		></video>
	{:else}
		<span class="font-medium text-xs">{file.name}</span>
		<span class="text-fainter text-[10px]">(cannot preview)</span>
	{/if}
	<div class="flex flex-col items-end gap-1 shrink-0">
		<button
			type="button"
			class="text-fainter hover:text-danger"
			style="font-size: 14px; line-height: 1; padding: 2px 4px;"
			aria-label={`Remove ${file.name}`}
			onclick={onRemove}>×</button
		>
		<span class="text-fainter font-mono text-[11px]">{fmtBytes(file.size)}</span>
	</div>
</div>
