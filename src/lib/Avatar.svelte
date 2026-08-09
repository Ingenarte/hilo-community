<script lang="ts">
  /**
   * Deterministic avatar with Gravatar lookup.
   *
   * UX states:
   *   1. resolving SHA-256 hash → render gradient skeleton + shimmer
   *   2. <img> requested, network in flight → keep the skeleton (NO flash of initials)
   *   3a. onload → fade into the photo
   *   3b. onerror (no gravatar for this email) → swap skeleton for the initials avatar
   *
   * Lookup results cached in sessionStorage so the second mount of the same
   * email skips the request entirely.
   */
  type Props = { email?: string; size?: number };
  const { email = '', size = 40 }: Props = $props();

  function initialsOf(s: string): string {
    if (!s) return '?';
    const left = s.includes('@') ? s.split('@')[0] : s;
    const parts = left.split(/[._\-+]+/).filter(Boolean);
    if (!parts.length) return s[0]?.toUpperCase() ?? '?';
    const a = parts[0][0] ?? '';
    const b = parts[1]?.[0] ?? '';
    return (a + b).toUpperCase();
  }

  function hue(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
    return Math.abs(h) % 360;
  }

  const text = $derived(initialsOf(email));
  const h = $derived(hue(email || 'anon'));
  const bg = $derived(`oklch(0.62 0.16 ${h})`);
  const bg2 = $derived(`oklch(0.72 0.16 ${(h + 35) % 360})`);
  const fontSize = $derived(Math.max(10, Math.round(size * 0.4)));

  type LookupState = 'idle' | 'pending' | 'loaded' | 'failed';
  let lookup: LookupState = $state<LookupState>('idle');
  let gravatarUrl: string | null = $state<string | null>(null);

  async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function cacheKey(emailNorm: string): string {
    return `hilo:gravatar:${emailNorm}`;
  }

  $effect(() => {
    lookup = 'idle';
    gravatarUrl = null;
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) return;
    if (typeof crypto === 'undefined' || !crypto.subtle) return;

    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem(cacheKey(normalized));
    } catch {}
    if (cached === 'missing') {
      lookup = 'failed';
      return;
    }

    lookup = 'pending';
    sha256Hex(normalized)
      .then((hash) => {
        if (cached && cached.startsWith('https://')) {
          gravatarUrl = cached;
        } else {
          gravatarUrl = `https://www.gravatar.com/avatar/${hash}?s=${size * 2}&d=404`;
        }
      })
      .catch(() => {
        lookup = 'failed';
      });
  });

  function onImgLoad() {
    lookup = 'loaded';
    try {
      if (gravatarUrl) sessionStorage.setItem(cacheKey(email.trim().toLowerCase()), gravatarUrl);
    } catch {}
  }
  function onImgError() {
    lookup = 'failed';
    gravatarUrl = null;
    try {
      sessionStorage.setItem(cacheKey(email.trim().toLowerCase()), 'missing');
    } catch {}
  }
</script>

<span
  class="avatar"
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{fontSize}px"
  style:background={lookup === 'failed'
    ? `linear-gradient(135deg, ${bg}, ${bg2})`
    : 'var(--glass-tint, oklch(1 0 0 / 0.06))'}
  title={email}
  aria-label={email}
>
  {#if gravatarUrl && lookup !== 'failed'}
    <img
      src={gravatarUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      class="avatar-img"
      class:loaded={lookup === 'loaded'}
      onload={onImgLoad}
      onerror={onImgError}
      referrerpolicy="no-referrer"
    />
  {/if}
  {#if lookup === 'failed'}
    <span class="initials">{text}</span>
  {:else if lookup !== 'loaded'}
    <span class="skeleton" aria-hidden="true"></span>
  {/if}
</span>

<style>
  .avatar {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: white;
    font-weight: 700;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
    flex-shrink: 0;
    user-select: none;
    line-height: 1;
    overflow: hidden;
  }
  .avatar-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 220ms ease-out, filter 220ms ease-out;
    filter: blur(6px);
  }
  .avatar-img.loaded {
    opacity: 1;
    filter: blur(0);
  }
  .initials {
    position: relative;
    z-index: 1;
  }
  .skeleton {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.05) 0%,
      rgba(255, 255, 255, 0.18) 50%,
      rgba(255, 255, 255, 0.05) 100%
    );
    background-size: 200% 100%;
    animation: avatar-shimmer 1.4s ease-in-out infinite;
  }
  @keyframes avatar-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton { animation: none; }
  }
</style>
