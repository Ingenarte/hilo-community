<script lang="ts">
	/**
	 * Help ("?") button + install guide for the navbar.
	 *
	 * Sits next to the "What's new" timeline button in `+layout.svelte`. Opens a
	 * dialog with one tab per platform (iOS / Android / Windows / macOS). Each tab
	 * plays a short Remotion explainer video (rendered into /static/help by the
	 * separate `video-remotion` project) and lists the written install steps.
	 *
	 * Windows and macOS additionally offer a copy-paste terminal command that adds
	 * the already-installed Hilo PWA to the OS startup so it launches
	 * minimized/hidden at login. The exact command bytes live in
	 * `src/lib/help/*.{ps1,command}` and are imported with `?raw` so quoting and
	 * backslashes survive verbatim (no JS-escaping bugs).
	 */
	import { onMount, tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { env as pubEnv } from '$env/dynamic/public';
	import { detectStandalone } from '$lib/pwa';

	import winCmdRaw from '$lib/help/startup-windows.ps1?raw';
	import winUndo from '$lib/help/startup-windows-undo.ps1?raw';
	import macCmdRaw from '$lib/help/startup-macos.command?raw';
	import macUndo from '$lib/help/startup-macos-undo.command?raw';

	// Instance URL comes from runtime env so guide copy and startup scripts
	// point at whatever host this deployment runs on. The raw script files
	// carry a literal `https://__HILO_BASE_URL__` token substituted here.
	const BASE_URL = pubEnv.PUBLIC_BASE_URL || 'http://localhost:5180';
	const HOST = new URL(BASE_URL).host;
	const winCmd = winCmdRaw.replaceAll('https://__HILO_BASE_URL__', BASE_URL);
	const macCmd = macCmdRaw.replaceAll('https://__HILO_BASE_URL__', BASE_URL);

	type PlatformKey = 'ios' | 'android' | 'windows' | 'macos';
	type Step = { title: string; detail: string };
	type Command = { label: string; note: string; code: string; undo: string };
	type Platform = {
		key: PlatformKey;
		label: string;
		kind: 'mobile' | 'desktop';
		steps: Step[];
		command?: Command;
	};

	const PLATFORMS: Platform[] = [
		{
			key: 'ios',
			label: 'iOS',
			kind: 'mobile',
			steps: [
				{ title: 'Open Hilo in Safari', detail: `Installing only works in Safari (not Chrome/Edge). Go to ${HOST}.` },
				{ title: 'Tap the Share button', detail: 'The square with an up arrow — bottom toolbar on iPhone, top bar on iPad.' },
				{ title: 'Add to Home Screen', detail: 'Scroll down the share sheet and tap “Add to Home Screen”.' },
				{ title: 'Keep “Open as Web App” on, then Add', detail: 'Leave the toggle on and tap Add. Hilo lands on your Home Screen and opens full-screen.' }
			]
		},
		{
			key: 'android',
			label: 'Android',
			kind: 'mobile',
			steps: [
				{ title: 'Open Hilo in Chrome', detail: `Go to ${HOST} and let the page finish loading.` },
				{ title: 'Open the ⋮ menu', detail: 'Tap the three-dot menu at the top-right of Chrome.' },
				{ title: 'Choose “Install app”', detail: 'On some phones it reads “Add to Home screen” — either one installs Hilo.' },
				{ title: 'Confirm', detail: 'Tap Install, then open Hilo from your home screen. It runs without the address bar.' }
			]
		},
		{
			key: 'windows',
			label: 'Windows',
			kind: 'desktop',
			steps: [
				{ title: 'Open Hilo in Chrome or Edge', detail: `Go to ${HOST}.` },
				{ title: 'Click the install icon', detail: 'A monitor-with-down-arrow at the right of the address bar. No icon? Chrome: ⋮ › Cast, save, and share › Install page as app. Edge: ⋮ › Apps › Install this site as an app.' },
				{ title: 'Click Install', detail: 'Hilo opens in its own window, separate from the browser tabs.' },
				{ title: 'Launch from the Start menu', detail: 'Search “Hilo”. Pin it to the taskbar if you like.' }
			],
			command: {
				label: 'Start Hilo minimized at login',
				note: 'Install the PWA first (steps above). Paste into PowerShell, Windows Terminal, or the Run dialog. It finds the installed Hilo shortcut and adds a minimized copy to your Startup folder.',
				code: winCmd,
				undo: winUndo
			}
		},
		{
			key: 'macos',
			label: 'macOS',
			kind: 'desktop',
			steps: [
				{ title: 'Open Hilo in Chrome or Edge', detail: `Go to ${HOST}.` },
				{ title: 'Click the install icon', detail: 'A monitor-with-down-arrow at the right of the address bar. No icon? Chrome: ⋮ › Cast, save, and share › Install page as app. Edge: ⋮ › Apps › Install this site as an app.' },
				{ title: 'Click Install', detail: 'Hilo reloads as a standalone app window.' },
				{ title: 'It’s in your Dock & Applications', detail: 'Find Hilo.app in Applications › Chrome Apps. Control-click the Dock icon › Options › Keep in Dock.' }
			],
			command: {
				label: 'Start Hilo hidden at login',
				note: 'Install the PWA first (steps above). Paste into Terminal. The first run shows a one-time “Terminal wants to control System Events” prompt — click OK.',
				code: macCmd,
				undo: macUndo
			}
		}
	];

	// Props: seenInstallHelpAt controls first-login auto-open behaviour.
	// onFirstClose is called the first time the modal is closed after being
	// auto-opened, giving the parent a chance to POST to seen-install-help.
	type Props = {
		seenInstallHelpAt?: number | null;
		onFirstClose?: () => void;
	};
	const { seenInstallHelpAt = undefined, onFirstClose }: Props = $props();

	let open = $state(false);
	let selected = $state<PlatformKey>('ios');
	let copiedId = $state<string | null>(null);
	let videoErrored = $state<Record<string, boolean>>({});
	let triggerRef = $state<HTMLButtonElement | null>(null);
	let closeRef = $state<HTMLButtonElement | null>(null);

	// True when the modal was opened automatically on first login (not by the
	// user clicking the ? button). Used to decide whether to fire onFirstClose.
	let wasAutoOpened = $state(false);

	const current = $derived(PLATFORMS.find((p) => p.key === selected) ?? PLATFORMS[0]);

	function detectDefault(): PlatformKey {
		if (typeof navigator === 'undefined') return 'ios';
		const ua = navigator.userAgent || '';
		const platform = navigator.platform || '';
		if (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1))
			return 'ios';
		if (/Android/.test(ua)) return 'android';
		if (/Win/.test(platform) || /Windows/.test(ua)) return 'windows';
		if (/Mac/.test(platform) || /Macintosh/.test(ua)) return 'macos';
		return 'ios';
	}

	async function openPanel(auto = false) {
		selected = detectDefault();
		open = true;
		if (auto) wasAutoOpened = true;
		await tick();
		closeRef?.focus();
	}

	function closePanel() {
		// If this close was triggered after an auto-open (first login), fire the
		// callback so the parent can mark seen and invalidate layout data.
		if (wasAutoOpened && seenInstallHelpAt === null) {
			onFirstClose?.();
		}
		wasAutoOpened = false;
		open = false;
		copiedId = null;
		triggerRef?.focus();
	}

	async function copy(text: string, id: string) {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				document.execCommand('copy');
				document.body.removeChild(ta);
			}
			copiedId = id;
			setTimeout(() => {
				if (copiedId === id) copiedId = null;
			}, 1800);
		} catch {
			// Clipboard blocked (insecure context / permissions). Leave the text
			// visible so the user can select it manually.
			copiedId = null;
		}
	}

	// The navbar <header> uses `backdrop-filter`, which makes it the containing
	// block for any `position: fixed` descendant — that would clamp this modal to
	// the header's height. Portal the dialog to <body> so `fixed inset-0` covers
	// the real viewport.
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function onTabKeydown(e: KeyboardEvent, idx: number) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault();
		const dir = e.key === 'ArrowRight' ? 1 : -1;
		const next = (idx + dir + PLATFORMS.length) % PLATFORMS.length;
		selected = PLATFORMS[next].key;
		tick().then(() => {
			document.getElementById(`help-tab-${PLATFORMS[next].key}`)?.focus();
		});
	}

	onMount(() => {
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape' && open) {
				e.stopPropagation();
				closePanel();
			}
		}
		document.addEventListener('keydown', onKeydown, { capture: true });

		// Auto-open on first login: show the install guide if the user has never
		// seen it AND they are not already running in standalone PWA mode.
		// seenInstallHelpAt === null means never seen (undefined means prop not
		// passed, i.e. no user logged in — skip auto-open in that case too).
		if (seenInstallHelpAt === null && !detectStandalone()) {
			void openPanel(true);
		}

		return () => document.removeEventListener('keydown', onKeydown, { capture: true });
	});
</script>

<button
	bind:this={triggerRef}
	type="button"
	class="btn btn-ghost btn-lg btn-icon"
	aria-label="Help — install Hilo on your devices"
	aria-haspopup="dialog"
	aria-expanded={open}
	title="Help — install Hilo"
	onclick={() => openPanel()}
>
	<svg
		width="18"
		height="18"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="10" />
		<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
		<line x1="12" y1="17" x2="12.01" y2="17" />
	</svg>
</button>

{#if open}
	<div
		use:portal
		class="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto p-4 pt-12"
		role="dialog"
		aria-modal="true"
		aria-labelledby="help-dialog-title"
		transition:fade={{ duration: 140 }}
	>
		<button
			type="button"
			class="absolute inset-0 cursor-default border-0 bg-black/70 p-0"
			aria-label="Close"
			tabindex="-1"
			onclick={closePanel}
		></button>

		<div
			class="glass-strong relative z-10 flex w-full max-w-2xl flex-col"
			style="max-height: calc(100dvh - 5rem);"
			in:fly={{ y: 10, duration: 220, easing: cubicOut }}
		>
			<!-- Header -->
			<div class="flex items-start justify-between px-6 pt-5 pb-3">
				<div>
					<div class="eyebrow mb-1">Help</div>
					<h2 id="help-dialog-title" class="text-lg font-bold tracking-tight">
						Install Hilo on your device
					</h2>
				</div>
				<button
					bind:this={closeRef}
					type="button"
					class="btn btn-ghost"
					style="height:32px; width:32px; padding:0; border-radius:999px;"
					aria-label="Close"
					onclick={closePanel}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Tabs -->
			<div
				class="flex gap-1 px-6 pb-3"
				role="tablist"
				aria-label="Choose your device"
			>
				{#each PLATFORMS as p, i}
					<button
						id={`help-tab-${p.key}`}
						type="button"
						role="tab"
						class="help-tab"
						class:active={selected === p.key}
						aria-selected={selected === p.key}
						tabindex={selected === p.key ? 0 : -1}
						onclick={() => (selected = p.key)}
						onkeydown={(e) => onTabKeydown(e, i)}
					>
						{p.label}
					</button>
				{/each}
			</div>

			<!-- Body -->
			<div class="thin-scroll flex-1 overflow-y-auto px-6 pb-6">
				{#key selected}
					<div in:fade={{ duration: 120 }}>
						<!-- Video -->
						<div
							class="mb-4 flex items-center justify-center overflow-hidden rounded-xl"
							style="background:#05070d; border:1px solid var(--glass-border);"
						>
							{#if videoErrored[selected]}
								<div class="text-fainter px-4 py-10 text-center text-xs leading-relaxed">
									The walkthrough video isn’t available yet.<br />
									Follow the written steps below.
								</div>
							{:else}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									class="block"
									style={current.kind === 'mobile'
										? 'max-height:42vh; width:auto; max-width:100%;'
										: 'width:100%; max-height:42vh;'}
									src={`/help/${selected}.mp4`}
									poster={`/help/${selected}.jpg`}
									controls
									autoplay
									muted
									loop
									playsinline
									preload="metadata"
									onerror={() => (videoErrored = { ...videoErrored, [selected]: true })}
								></video>
							{/if}
						</div>

						<!-- Steps -->
						<ol class="space-y-2.5">
							{#each current.steps as step, i}
								<li class="flex gap-3">
									<span
										class="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white"
										style="background:linear-gradient(135deg, var(--color-accent), var(--color-accent-2));"
										aria-hidden="true"
									>
										{i + 1}
									</span>
									<div>
										<div class="text-sm font-semibold leading-snug">{step.title}</div>
										<div class="text-muted text-[12.5px] leading-snug">{step.detail}</div>
									</div>
								</li>
							{/each}
						</ol>

						<!-- Startup command (desktop only) -->
						{#if current.command}
							<div class="mt-5 border-t pt-4" style="border-color: var(--glass-border);">
								<div class="flex items-center justify-between gap-2">
									<div class="text-sm font-semibold">{current.command.label}</div>
									<button
										type="button"
										class="btn"
										style="height:30px; padding:0 12px; font-size:12px;"
										onclick={() => current.command && copy(current.command.code, `cmd-${selected}`)}
									>
										{copiedId === `cmd-${selected}` ? 'Copied ✓' : 'Copy command'}
									</button>
								</div>
								<p class="text-fainter mt-1.5 text-[12px] leading-relaxed">
									{current.command.note}
								</p>
								<pre class="help-code thin-scroll mt-2">{current.command.code}</pre>

								<details class="mt-2">
									<summary class="link cursor-pointer text-[12px]">Remove from startup</summary>
									<div class="mt-2 flex justify-end">
										<button
											type="button"
											class="btn btn-ghost"
											style="height:28px; padding:0 10px; font-size:11.5px;"
											onclick={() => current.command && copy(current.command.undo, `undo-${selected}`)}
										>
											{copiedId === `undo-${selected}` ? 'Copied ✓' : 'Copy undo command'}
										</button>
									</div>
									<pre class="help-code thin-scroll mt-2">{current.command.undo}</pre>
								</details>
							</div>
						{/if}
					</div>
				{/key}
			</div>
		</div>
	</div>
{/if}

<style>
	.help-tab {
		flex: 1;
		height: 34px;
		border-radius: 10px;
		border: 1px solid var(--glass-border);
		background: transparent;
		color: var(--color-muted);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}
	.help-tab:hover {
		background: var(--glass-tint);
		color: var(--color-text);
	}
	.help-tab.active {
		color: #fff;
		border-color: transparent;
		background: linear-gradient(135deg, var(--color-accent), var(--color-accent-2));
	}
	.help-tab:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.help-code {
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--color-text);
		background: #05070d;
		border: 1px solid var(--glass-border);
		border-radius: 10px;
		padding: 12px 14px;
		max-height: 150px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
