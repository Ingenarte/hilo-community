<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { detectStandalone } from '$lib/pwa';

  /** `icon`: compact navbar button. `menu`: row inside a dropdown. */
  type Props = { variant?: 'icon' | 'menu' };
  const { variant = 'icon' }: Props = $props();

  type BIPEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };

  let bip = $state<BIPEvent | null>(null);
  let installed = $state(false);
  let isIOS = $state(false);
  let isStandalone = $state(false);
  let showIOSGuide = $state(false);

  function detectIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    // iOS Safari OR Safari running on iPadOS (which masquerades as Mac)
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  async function install() {
    if (!bip) return;
    bip.prompt();
    const choice = await bip.userChoice;
    if (choice.outcome === 'accepted') installed = true;
    bip = null;
  }

  onMount(() => {
    isStandalone = detectStandalone();
    isIOS = detectIOS();
    const onBIP = (ev: Event) => {
      ev.preventDefault();
      bip = ev as BIPEvent;
    };
    const onInstalled = () => {
      installed = true;
      bip = null;
    };
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  // What the visible affordance should do:
  //   - If we have a BIP captured, run the native install prompt.
  //   - If on iOS (no BIP exists), open the manual instructions modal.
  //   - Otherwise hide the button entirely (already installed,
  //     unsupported browser, etc.).
  const shouldShow = $derived(!installed && !isStandalone && (bip || isIOS));
</script>

{#if shouldShow}
  {#if variant === 'menu'}
    <button
      type="button"
      class="menu-item"
      role="menuitem"
      aria-label="Install Hilo"
      onclick={() => (bip ? install() : (showIOSGuide = true))}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Install app
    </button>
  {:else}
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      aria-label="Install Hilo"
      title="Install Hilo as an app"
      onclick={() => (bip ? install() : (showIOSGuide = true))}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span class="hidden md:inline ml-1.5 text-xs">Install</span>
    </button>
  {/if}
{/if}

{#if showIOSGuide}
  <div
    class="fixed inset-0 z-[200] flex items-start justify-center p-4 pt-16 overflow-y-auto"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ios-install-title"
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/75 p-0"
      aria-label="Close instructions"
      onclick={() => (showIOSGuide = false)}
    ></button>
    <div
      class="glass-strong relative z-10 w-full max-w-md p-6"
      in:fly={{ y: 8, duration: 240, easing: cubicOut }}
    >
      <div class="eyebrow mb-1">iOS Safari</div>
      <h2 id="ios-install-title" class="text-lg font-bold tracking-tight mb-3">
        Install Hilo on your iPhone or iPad
      </h2>
      <ol class="text-sm space-y-3 text-muted list-decimal pl-5">
        <li>Tap the <strong>Share</strong> icon at the bottom of Safari
          (a square with an arrow pointing up).</li>
        <li>Scroll down in the share sheet until you see
          <strong>Add to Home Screen</strong>. Tap it.</li>
        <li>Confirm the name (<strong>Hilo</strong>) and tap
          <strong>Add</strong> in the top right.</li>
      </ol>
      <p class="text-fainter text-xs mt-4 leading-relaxed">
        On iOS 16.4+ the installed Hilo can also receive push notifications.
        Open it from the Home Screen at least once, then enable notifications
        from the banner.
      </p>
      <div class="flex justify-end mt-4">
        <button class="btn" onclick={() => (showIOSGuide = false)}>Got it</button>
      </div>
    </div>
  </div>
{/if}
