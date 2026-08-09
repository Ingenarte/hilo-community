<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getSoundEnabled, setSoundEnabled } from '$lib/activity';

  type SchedulePreset = { key: string; label: string; tz: string | null };

  type Props = {
    data: {
      schedule: string;
      schedulePresets: SchedulePreset[];
    };
  };

  const { data }: Props = $props();

  let busy = $state(false);
  let soundOn = $state(true);
  onMount(() => {
    soundOn = getSoundEnabled();
  });
  function toggleSound(on: boolean) {
    soundOn = on;
    setSoundEnabled(on);
  }

  async function saveSchedule(value: string) {
    busy = true;
    try {
      await fetch('/api/notify-schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schedule: value })
      });
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  // ── Password change form state ─────────────────────────────────────────────
  const MIN_PASSWORD_LENGTH = 8;

  let pwCurrent = $state('');
  let pwNext = $state('');
  let pwConfirm = $state('');
  let pwBusy = $state(false);
  let pwSuccess = $state<string | null>(null);
  let pwError = $state<string | null>(null);

  // Client-side validity: all three filled, next === confirm, length ok.
  const pwValid = $derived(
    pwCurrent.length > 0 &&
      pwNext.length >= MIN_PASSWORD_LENGTH &&
      pwNext === pwConfirm
  );

  async function submitPasswordChange() {
    if (!pwValid || pwBusy) return;
    pwBusy = true;
    pwSuccess = null;
    pwError = null;
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current: pwCurrent, next: pwNext })
      });
      const body = (await res.json()) as {
        ok?: boolean;
        other_sessions_revoked?: number;
        error?: string;
      };
      if (res.ok) {
        const n = body.other_sessions_revoked ?? 0;
        pwSuccess =
          n === 0
            ? 'Password updated.'
            : `Password updated. ${n} other ${n === 1 ? 'device has' : 'devices have'} been signed out.`;
        pwCurrent = '';
        pwNext = '';
        pwConfirm = '';
      } else {
        const msg: Record<string, string> = {
          invalid_current_password: 'Current password is incorrect.',
          weak_password: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
          password_unchanged: 'New password must differ from the current one.',
          no_password_set: 'Your account has no password set. Contact an administrator.',
          rate_limited: 'Too many attempts. Please wait a moment and try again.'
        };
        pwError = msg[body.error ?? ''] ?? 'Something went wrong. Please try again.';
      }
    } catch {
      pwError = 'Network error. Please check your connection and try again.';
    } finally {
      pwBusy = false;
    }
  }
</script>

<section class="max-w-2xl mx-auto px-6 py-10">
  <header in:fly={{ y: -8, duration: 320, easing: cubicOut }} class="mb-6">
    <div class="eyebrow mb-2">Settings</div>
    <h1 class="text-3xl font-bold tracking-tight">Preferences</h1>
  </header>

  <div class="glass p-6 space-y-4">
    <div>
      <div class="text-base font-bold tracking-tight">Notification window</div>
      <p class="text-muted text-sm mt-1 leading-relaxed">
        Choose when we should email you. Immediate sends as soon as a reply
        lands. Regional options queue messages until the next 9–18 weekday in
        that timezone.
      </p>
    </div>

    <label class="block">
      <span class="sr-only">Schedule</span>
      <select
        class="select"
        bind:value={data.schedule}
        disabled={busy}
        onchange={(e) => saveSchedule((e.target as HTMLSelectElement).value)}
      >
        {#each data.schedulePresets as p}
          <option value={p.key}>{p.label}</option>
        {/each}
      </select>
    </label>

    <p class="text-fainter text-xs">
      Current selection:
      <code class="font-mono text-muted">{data.schedule}</code>
    </p>
  </div>

  <div class="glass p-6 space-y-4 mt-6">
    <div>
      <div class="text-base font-bold tracking-tight">In-app sound</div>
      <p class="text-muted text-sm mt-1 leading-relaxed">
        Play a short tone when a new message or ticket activity arrives on
        any open tab. Browsers may suppress the first sound until you've
        interacted with the page at least once.
      </p>
    </div>
    <label class="flex items-center gap-2.5 py-2 select-none cursor-pointer">
      <input
        type="checkbox"
        class="h-5 w-5 rounded"
        checked={soundOn}
        onchange={(e) => toggleSound((e.target as HTMLInputElement).checked)}
      />
      <span class="text-sm">Play a tone on new activity</span>
    </label>
  </div>

  <div class="glass p-6 space-y-3 mt-6">
    <div>
      <div class="text-base font-bold tracking-tight">Open at startup</div>
      <p class="text-muted text-sm mt-1 leading-relaxed">
        The browser security model doesn't let a web app add itself to the
        OS startup list. Set it manually so Hilo opens with the computer:
      </p>
    </div>
    <ul class="text-sm space-y-1.5 text-muted">
      <li>
        <strong class="text-body">macOS:</strong> System Settings → General →
        Login Items → <code class="font-mono">+</code> → select Hilo
      </li>
      <li>
        <strong class="text-body">Windows:</strong> Settings → Apps → Startup →
        toggle Hilo on
      </li>
      <li>
        <strong class="text-body">Chrome / Edge:</strong>
        <code class="font-mono">chrome://apps</code> → right-click Hilo →
        "Open at login"
      </li>
    </ul>
  </div>

  <!-- Account block: password change form -->
  <div class="glass p-6 space-y-4 mt-6">
    <div>
      <div class="text-base font-bold tracking-tight">Account</div>
      <p class="text-muted text-sm mt-1 leading-relaxed">
        Change your login password. All other signed-in devices will be
        signed out automatically when you update it.
      </p>
    </div>

    <form
      class="space-y-4"
      onsubmit={(e) => { e.preventDefault(); submitPasswordChange(); }}
      novalidate
    >
      <div>
        <label for="pw-current" class="block text-sm font-medium mb-1">
          Current password
        </label>
        <input
          id="pw-current"
          type="password"
          class="input w-full"
          autocomplete="current-password"
          required
          bind:value={pwCurrent}
          disabled={pwBusy}
        />
      </div>

      <div>
        <label for="pw-next" class="block text-sm font-medium mb-1">
          New password
          <span class="text-fainter font-normal text-xs">
            (at least {MIN_PASSWORD_LENGTH} characters)
          </span>
        </label>
        <input
          id="pw-next"
          type="password"
          class="input w-full"
          autocomplete="new-password"
          required
          minlength={MIN_PASSWORD_LENGTH}
          bind:value={pwNext}
          disabled={pwBusy}
        />
      </div>

      <div>
        <label for="pw-confirm" class="block text-sm font-medium mb-1">
          Confirm new password
        </label>
        <input
          id="pw-confirm"
          type="password"
          class="input w-full"
          autocomplete="new-password"
          required
          bind:value={pwConfirm}
          disabled={pwBusy}
        />
        {#if pwConfirm.length > 0 && pwNext !== pwConfirm}
          <p class="text-xs mt-1 pw-error">
            Passwords do not match.
          </p>
        {/if}
      </div>

      {#if pwSuccess}
        <p class="text-sm pw-success">{pwSuccess}</p>
      {/if}
      {#if pwError}
        <p class="text-sm pw-error">{pwError}</p>
      {/if}

      <div class="flex justify-end">
        <button
          type="submit"
          class="btn btn-primary"
          disabled={!pwValid || pwBusy}
        >
          {pwBusy ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </form>
  </div>
</section>

<style>
  .pw-error {
    color: var(--color-danger);
  }
  .pw-success {
    color: var(--color-success);
  }
</style>
