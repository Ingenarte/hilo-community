<script lang="ts">
  /**
   * Dropdown menu anchored to its trigger. Closes on outside click,
   * Escape, or when an item inside is activated. Keyboard: arrow keys
   * move between items, Home/End jump, Tab leaves and closes.
   */
  import { onMount, type Snippet } from 'svelte';
  import { scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Props = {
    trigger: Snippet<[{ open: boolean }]>;
    children: Snippet;
    align?: 'left' | 'right';
    label: string;
    class?: string;
  };
  let { trigger, children, align = 'right', label, class: cls = '' }: Props = $props();

  let open = $state(false);
  let root: HTMLElement | null = $state(null);
  let panel: HTMLElement | null = $state(null);

  function items(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>('.menu-item:not([disabled])'));
  }

  function toggle() {
    open = !open;
    if (open) queueMicrotask(() => items()[0]?.focus());
  }

  function close() {
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      (root?.querySelector<HTMLElement>('[aria-haspopup]'))?.focus();
      return;
    }
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Tab') close();
  }

  onMount(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      if (root && !root.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  });
</script>

<div class="relative inline-flex {cls}" bind:this={root} onkeydown={onKey} role="presentation">
  <button
    type="button"
    class="inline-flex"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    onclick={toggle}
  >
    {@render trigger({ open })}
  </button>

  {#if open}
    <div
      bind:this={panel}
      class="glass-strong menu absolute top-full mt-2 z-[60] {align === 'right' ? 'right-0' : 'left-0'}"
      role="menu"
      tabindex="-1"
      aria-label={label}
      transition:scale={{ start: 0.96, duration: 140, easing: cubicOut, opacity: 0 }}
      onclick={(e) => {
        const t = (e.target as HTMLElement).closest('.menu-item');
        if (t && !t.hasAttribute('data-keep-open')) close();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const t = (e.target as HTMLElement).closest('.menu-item');
          if (t && !t.hasAttribute('data-keep-open')) queueMicrotask(close);
        }
      }}
    >
      {@render children()}
    </div>
  {/if}
</div>
