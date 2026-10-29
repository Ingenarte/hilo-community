<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getSoundEnabled, setSoundEnabled } from '$lib/activity';
  import AgentTokenModal from '$lib/AgentTokenModal.svelte';
  import { MIN_PASSWORD_LENGTH, PASSWORD_PROBLEM_MESSAGE } from '$lib/passwordPolicy';
  import {
    DEFAULT_REMINDER_PREFS,
    DUE_SOON_HOUR_CHOICES,
    WEEKDAY_NAMES,
    hhmmToMinutes,
    isWorkDay,
    minutesToHHMM,
    workDayBit,
    type ReminderPrefs
  } from '$lib/reminderRules';
  import {
    browserSupportsWebAuthn,
    defaultPasskeyName,
    registerPasskey
  } from '$lib/passkeyClient';

  // ── Agent tokens ──────────────────────────────────────────────────────────
  type ApiToken = {
    id: number;
    name: string;
    prefix: string;
    ticket_id: number | null;
    can_reply: boolean;
    expires_at: number;
    created_at: number;
    last_used_at: number | null;
  };
  let tokens = $state<ApiToken[]>([]);
  let tokenModalOpen = $state(false);
  let tokensError = $state<string | null>(null);

  async function loadTokens() {
    try {
      const res = await fetch('/api/tokens');
      if (res.ok) tokens = (await res.json()).tokens ?? [];
    } catch {
      tokensError = 'Could not load your tokens.';
    }
  }
  async function revokeToken(id: number) {
    if (!confirm('Revoke this token? Any agent using it loses access immediately.')) return;
    const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      tokensError = 'Could not revoke the token.';
      return;
    }
    tokensError = null;
    await loadTokens();
  }
  function fmtExpiry(unix: number) {
    return new Date(unix * 1000).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
  onMount(loadTokens);

  // ── Deadline reminders ────────────────────────────────────────────────────
  let rem = $state<ReminderPrefs>({ ...DEFAULT_REMINDER_PREFS });
  let remTz = $state(''); // '' = "use the default for me"
  let remEffectiveTz = $state('');
  let remBrowserTz = $state('');
  let remLoaded = $state(false);
  let remBusy = $state(false);
  let remTestBusy = $state(false);
  let remMsg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // <input type="time"> works with "HH:MM" strings.
  let remWorkStart = $state('09:00');
  let remWorkEnd = $state('18:00');
  let remDigestTime = $state('09:00');
  let remOverdueTime = $state('09:00');

  const ZONES: string[] = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC', 'Europe/Rome', 'Europe/Madrid', 'Europe/London', 'America/Argentina/Buenos_Aires',
        'America/New_York', 'America/Los_Angeles', 'America/Mexico_City', 'Asia/Tokyo'];
    }
  })();

  function applyRem(p: ReminderPrefs, effective: string) {
    rem = { ...p };
    remTz = p.tz ?? '';
    remEffectiveTz = effective;
    remWorkStart = minutesToHHMM(p.workStart);
    remWorkEnd = minutesToHHMM(p.workEnd);
    remDigestTime = minutesToHHMM(p.digestTime);
    remOverdueTime = minutesToHHMM(p.overdueTime);
  }
  async function loadReminders() {
    try {
      remBrowserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const res = await fetch('/api/reminders/prefs');
      if (!res.ok) throw new Error('load');
      const body = await res.json();
      applyRem(body.prefs, body.effectiveTz);
      remLoaded = true;
    } catch {
      remMsg = { kind: 'error', text: 'Could not load your reminder settings.' };
    }
  }
  function toggleDay(jsWeekday: number) {
    rem.workDays = rem.workDays ^ workDayBit(jsWeekday);
  }
  async function saveReminders() {
    if (remBusy) return;
    const ws = hhmmToMinutes(remWorkStart);
    const we = hhmmToMinutes(remWorkEnd);
    const dt = hhmmToMinutes(remDigestTime);
    const ot = hhmmToMinutes(remOverdueTime);
    if (ws === null || we === null || dt === null || ot === null) {
      remMsg = { kind: 'error', text: 'Enter every time as HH:MM.' };
      return;
    }
    remBusy = true;
    remMsg = null;
    try {
      const res = await fetch('/api/reminders/prefs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...rem,
          tz: remTz || null,
          workStart: ws,
          workEnd: we,
          digestTime: dt,
          overdueTime: ot
        })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        applyRem(body.prefs, body.effectiveTz);
        remMsg = { kind: 'ok', text: 'Reminder settings saved.' };
      } else {
        remMsg = { kind: 'error', text: body.error ?? 'Could not save. Please try again.' };
      }
    } catch {
      remMsg = { kind: 'error', text: 'Could not save. Please try again.' };
    } finally {
      remBusy = false;
    }
  }
  async function sendReminderTest() {
    if (remTestBusy) return;
    remTestBusy = true;
    remMsg = null;
    try {
      const res = await fetch('/api/reminders/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const body = await res.json().catch(() => ({}));
      remMsg = res.ok
        ? { kind: 'ok', text: `Test email on its way to ${body.email}. It arrives within a minute.` }
        : { kind: 'error', text: body.error ?? 'Could not send the test email.' };
    } catch {
      remMsg = { kind: 'error', text: 'Could not send the test email.' };
    } finally {
      remTestBusy = false;
    }
  }
  onMount(loadReminders);

  // ── Passkeys ──────────────────────────────────────────────────────────────
  type Passkey = {
    id: number;
    name: string;
    created_at: number;
    last_used_at: number | null;
    synced: boolean;
  };
  let passkeys = $state<Passkey[]>([]);
  let passkeySupported = $state(false);
  let passkeyName = $state('');
  let passkeyBusy = $state(false);
  let passkeyMsg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function loadPasskeys() {
    try {
      const res = await fetch('/api/passkeys');
      if (res.ok) passkeys = (await res.json()).passkeys ?? [];
    } catch {
      passkeyMsg = { kind: 'error', text: 'Could not load your passkeys.' };
    }
  }
  async function addPasskey() {
    if (passkeyBusy) return;
    passkeyBusy = true;
    passkeyMsg = null;
    const result = await registerPasskey(passkeyName.trim() || defaultPasskeyName());
    passkeyBusy = false;
    if (result.ok) {
      passkeyName = '';
      passkeyMsg = { kind: 'ok', text: 'Passkey added. You can now sign in with it.' };
      await loadPasskeys();
      await invalidateAll();
    } else if (!result.cancelled) {
      passkeyMsg = { kind: 'error', text: result.error };
    }
  }
  async function removePasskey(p: Passkey) {
    if (!confirm(`Remove the passkey "${p.name}"? You will no longer be able to sign in with it.`)) return;
    const res = await fetch(`/api/passkeys/${p.id}`, { method: 'DELETE' });
    if (!res.ok) {
      passkeyMsg = { kind: 'error', text: 'Could not remove the passkey.' };
      return;
    }
    passkeyMsg = { kind: 'ok', text: 'Passkey removed.' };
    await loadPasskeys();
    await invalidateAll();
  }
  function fmtDay(unix: number) {
    return new Date(unix * 1000).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  onMount(() => {
    passkeySupported = browserSupportsWebAuthn();
    passkeyName = defaultPasskeyName();
    loadPasskeys();
  });

  type SchedulePreset = { key: string; label: string; tz: string | null };

  type Props = {
    data: {
      schedule: string;
      schedulePresets: SchedulePreset[];
      passkeysEnabled: boolean;
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
        // Refresh layout data so the "change your password" reminder goes away.
        await invalidateAll();
      } else {
        const msg: Record<string, string> = {
          invalid_current_password: 'Current password is incorrect.',
          weak_password: PASSWORD_PROBLEM_MESSAGE.too_short,
          too_long: PASSWORD_PROBLEM_MESSAGE.too_long,
          too_common: PASSWORD_PROBLEM_MESSAGE.too_common,
          repetitive: PASSWORD_PROBLEM_MESSAGE.repetitive,
          contains_email: PASSWORD_PROBLEM_MESSAGE.contains_email,
          pwned: PASSWORD_PROBLEM_MESSAGE.pwned,
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
  <div id="password" class="glass p-6 space-y-4 mt-6 scroll-mt-24">
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

  <!-- Deadline reminders -->
  <div id="reminders" class="glass p-6 space-y-5 mt-6 scroll-mt-24 min-w-0" data-testid="reminders">
    <div>
      <div class="text-base font-bold tracking-tight">Deadline reminders</div>
      <p class="text-muted text-sm mt-1 leading-relaxed">
        Emails about the response time of your tickets. The clock restarts with every message,
        so a ticket is "due" when nobody has written for its whole target (72 hours at normal
        priority). You only get the tickets you can see.
      </p>
    </div>

    {#if remLoaded}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="min-w-0">
          <label for="rem-tz" class="label block mb-1.5">Time zone</label>
          <select id="rem-tz" class="select w-full min-w-0 max-w-full" bind:value={remTz}>
            <option value="">Default ({remEffectiveTz || 'server'})</option>
            {#if remBrowserTz && remBrowserTz !== remEffectiveTz}
              <option value={remBrowserTz}>This device: {remBrowserTz}</option>
            {/if}
            {#each ZONES as z (z)}
              <option value={z}>{z}</option>
            {/each}
          </select>
        </div>
        <div class="min-w-0">
          <span class="label block mb-1.5">Working hours</span>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center min-w-0">
            <label class="flex items-center gap-2 min-w-0 sm:flex-1">
              <span class="text-xs text-muted w-10 shrink-0 sm:hidden">From</span>
              <input type="time" class="input min-w-0 flex-1" aria-label="Working hours start" bind:value={remWorkStart} />
            </label>
            <span class="text-muted hidden sm:inline">to</span>
            <label class="flex items-center gap-2 min-w-0 sm:flex-1">
              <span class="text-xs text-muted w-10 shrink-0 sm:hidden">To</span>
              <input type="time" class="input min-w-0 flex-1" aria-label="Working hours end" bind:value={remWorkEnd} />
            </label>
          </div>
        </div>
      </div>

      <fieldset>
        <legend class="label mb-1.5">Working days</legend>
        <div class="flex flex-wrap gap-2">
          {#each [1, 2, 3, 4, 5, 6, 0] as d (d)}
            <label class="chip cursor-pointer select-none" style="gap:6px;">
              <input type="checkbox" checked={isWorkDay(rem.workDays, d)} onchange={() => toggleDay(d)}
                     aria-label={WEEKDAY_NAMES[d]} />
              {WEEKDAY_NAMES[d].slice(0, 3)}
            </label>
          {/each}
        </div>
      </fieldset>

      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label class="inline-flex items-center gap-2 text-sm sm:min-w-[260px]">
            <input type="checkbox" bind:checked={rem.dueSoonEnabled} data-testid="rem-due-soon" />
            Alert me before a ticket is due
          </label>
          <label class="inline-flex flex-wrap items-center gap-2 text-sm text-muted max-w-full">
            <select class="select w-auto max-w-full" aria-label="Hours before the deadline" bind:value={rem.dueSoonHours}
                    disabled={!rem.dueSoonEnabled}>
              {#each DUE_SOON_HOUR_CHOICES as h (h)}
                <option value={h}>{h} hours before</option>
              {/each}
            </select>
            <span class="text-xs text-fainter">sent during working hours</span>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label class="inline-flex items-center gap-2 text-sm sm:min-w-[260px]">
            <input type="checkbox" bind:checked={rem.digestEnabled} data-testid="rem-digest" />
            Daily summary of what is due in the next 24 hours
          </label>
          <label class="inline-flex flex-wrap items-center gap-2 text-sm text-muted max-w-full">
            at
            <input type="time" class="input w-auto min-w-0" style="padding: 0 0.5rem;" aria-label="Daily summary time" bind:value={remDigestTime}
                   disabled={!rem.digestEnabled} />
            <span class="text-xs text-fainter">on working days</span>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label class="inline-flex items-center gap-2 text-sm sm:min-w-[260px]">
            <input type="checkbox" bind:checked={rem.overdueEnabled} data-testid="rem-overdue" />
            Weekly summary of overdue tickets
          </label>
          <label class="inline-flex flex-wrap items-center gap-2 text-sm text-muted max-w-full">
            <select class="select w-auto max-w-full" aria-label="Weekly summary day" bind:value={rem.overdueWeekday}
                    disabled={!rem.overdueEnabled}>
              {#each [1, 2, 3, 4, 5, 6, 0] as d (d)}
                <option value={d}>{WEEKDAY_NAMES[d]}</option>
              {/each}
            </select>
            at
            <input type="time" class="input w-auto min-w-0" style="padding: 0 0.5rem;" aria-label="Weekly summary time" bind:value={remOverdueTime}
                   disabled={!rem.overdueEnabled} />
          </label>
        </div>
      </div>

      {#if remMsg}
        <p class="text-sm" role={remMsg.kind === 'error' ? 'alert' : 'status'} data-testid="rem-message"
           style={remMsg.kind === 'error' ? 'color: var(--color-danger);' : ''}>
          {remMsg.text}
        </p>
      {/if}

      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary" onclick={saveReminders} disabled={remBusy} data-testid="rem-save">
          {remBusy ? 'Saving…' : 'Save reminders'}
        </button>
        <button type="button" class="btn" onclick={sendReminderTest} disabled={remTestBusy} data-testid="rem-test">
          {remTestBusy ? 'Sending…' : 'Send me a test email'}
        </button>
      </div>
    {:else if remMsg}
      <p class="text-sm" role="alert" style="color: var(--color-danger);">{remMsg.text}</p>
    {:else}
      <p class="text-sm text-fainter">Loading…</p>
    {/if}
  </div>

  <!-- Passkeys -->
  {#if data.passkeysEnabled}
    <div id="passkeys" class="glass p-6 space-y-4 mt-6 scroll-mt-24" data-testid="passkeys">
      <div>
        <div class="text-base font-bold tracking-tight">Passkeys</div>
        <p class="text-muted text-sm mt-1 leading-relaxed">
          Sign in with your fingerprint, face or screen lock instead of a password. Nothing to
          remember, and it cannot be phished. Your password keeps working as a backup.
        </p>
      </div>

      {#if passkeys.length === 0}
        <p class="text-sm text-fainter">No passkeys yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each passkeys as p (p.id)}
            <li class="flex items-center gap-3 text-sm" data-passkey-id={p.id}>
              <div class="min-w-0 flex-1">
                <div class="font-medium truncate">{p.name}</div>
                <div class="text-xs text-fainter">
                  Added {fmtDay(p.created_at)}
                  · {p.last_used_at ? `last used ${fmtDay(p.last_used_at)}` : 'never used'}
                  {#if p.synced}· synced across your devices{/if}
                </div>
              </div>
              <button type="button" class="btn" onclick={() => removePasskey(p)}>Remove</button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if passkeyMsg}
        <p
          class="text-sm"
          role={passkeyMsg.kind === 'error' ? 'alert' : 'status'}
          style={passkeyMsg.kind === 'error' ? 'color: var(--color-danger);' : ''}
          data-testid="passkey-message"
        >
          {passkeyMsg.text}
        </p>
      {/if}

      {#if passkeySupported}
        <form
          class="flex flex-wrap items-end gap-2"
          onsubmit={(e) => { e.preventDefault(); addPasskey(); }}
        >
          <div class="flex-1 min-w-[180px]">
            <label for="passkey-name" class="label block mb-1.5">Name</label>
            <input id="passkey-name" class="input" maxlength="60" bind:value={passkeyName} />
          </div>
          <button type="submit" class="btn btn-primary" disabled={passkeyBusy} data-testid="passkey-add">
            {passkeyBusy ? 'Waiting for your device…' : 'Add a passkey'}
          </button>
        </form>
      {:else}
        <p class="text-sm text-fainter">This browser does not support passkeys.</p>
      {/if}
    </div>
  {/if}

  <!-- Agent tokens -->
  <div class="glass p-6 space-y-4 mt-6" data-testid="agent-tokens">
    <div>
      <div class="text-base font-bold tracking-tight">Agent tokens</div>
      <p class="text-muted text-sm mt-1 leading-relaxed">
        Let a coding agent (Claude Code, VS Code) read your tickets and write back. Tokens last
        96 hours and only work on the agent API. To limit one to a single ticket, use
        "Generate agent token" in that ticket's sidebar.
      </p>
    </div>

    {#if tokens.length === 0}
      <p class="text-sm text-fainter">No active tokens.</p>
    {:else}
      <ul class="space-y-2">
        {#each tokens as t (t.id)}
          <li class="flex items-center gap-3 text-sm" data-token-id={t.id}>
            <div class="min-w-0 flex-1">
              <div class="font-medium truncate">{t.name}</div>
              <div class="text-xs text-fainter font-mono">
                {t.prefix}… · {t.ticket_id != null ? `ticket #${t.ticket_id}` : 'all my tickets'}
                · {t.can_reply ? 'can reply' : 'read-only'} · expires {fmtExpiry(t.expires_at)}
              </div>
            </div>
            <button type="button" class="btn" onclick={() => revokeToken(t.id)}>Revoke</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if tokensError}
      <p class="text-sm pw-error">{tokensError}</p>
    {/if}

    <div class="flex justify-end">
      <button type="button" class="btn btn-primary" onclick={() => (tokenModalOpen = true)}>
        Generate token for all my tickets
      </button>
    </div>
  </div>
</section>

<AgentTokenModal
  open={tokenModalOpen}
  ticketId={null}
  onclose={() => (tokenModalOpen = false)}
  oncreated={loadTokens}
/>

<style>
  .pw-error {
    color: var(--color-danger);
  }
  .pw-success {
    color: var(--color-success);
  }
</style>
