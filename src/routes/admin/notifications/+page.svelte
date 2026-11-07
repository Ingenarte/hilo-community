<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  type U = { id: number; email: string; role: string; notify_mode: string | null; hasPush: boolean };
  type Props = {
    data: { defaultMode: 'auto' | 'email' | 'push'; dailyCap: boolean; pushAvailable: boolean; users: U[] };
    form?: { ok?: boolean; error?: string } | null;
  };
  const { data, form }: Props = $props();

  let mode = $state<'auto' | 'email' | 'push'>('auto');
  let cap = $state(false);
  $effect(() => {
    mode = data.defaultMode;
    cap = data.dailyCap;
  });

  const MODES = [
    { id: 'auto', label: 'Automatic', hint: 'Push for people who enabled it, email for everyone else.' },
    { id: 'email', label: 'Email only', hint: 'Everyone gets email, push is never sent.' },
    { id: 'push', label: 'Push first', hint: 'Push when available, email as a fallback. Same as Automatic today.' }
  ] as const;

  function effective(u: U): string {
    const m = u.notify_mode ?? data.defaultMode;
    if (m === 'email') return 'Email';
    return u.hasPush ? 'Push' : 'Email';
  }
</script>

<section class="max-w-4xl mx-auto px-6 py-8 lg:px-8">
  <header class="mb-5">
    <div class="eyebrow mb-2">Admin</div>
    <h1 class="text-3xl font-bold tracking-tight">Notifications</h1>
    <p class="text-sm text-muted mt-1">
      Choose how people hear about ticket activity: new messages, status, priority, assignment,
      deadline and project changes. Each person gets one channel, not both.
    </p>
  </header>

  {#if !data.pushAvailable}
    <p class="glass p-3 mb-4 text-sm" data-testid="push-unavailable">
      Web push is not configured on this server (no VAPID keys), so everyone receives email.
    </p>
  {/if}

  <form method="POST" action="?/settings" class="glass p-4 mb-5" data-testid="notify-settings"
        use:enhance={() => async ({ update }) => { await update({ reset: false }); await invalidateAll(); }}>
    <h2 class="text-sm font-semibold mb-3">Default for everyone</h2>
    <div class="flex flex-col gap-2 mb-4" role="radiogroup" aria-label="Default delivery mode">
      {#each MODES as m (m.id)}
        <label class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer"
               style="border-color: {mode === m.id ? 'var(--color-accent)' : 'var(--glass-border)'};">
          <input type="radio" name="mode" value={m.id} bind:group={mode} class="mt-1" data-testid="mode-{m.id}" />
          <span>
            <span class="block text-sm font-medium">{m.label}</span>
            <span class="block text-xs text-fainter">{m.hint}</span>
          </span>
        </label>
      {/each}
    </div>
    <label class="flex items-start gap-3 mb-4 cursor-pointer">
      <input type="checkbox" name="dailyCap" bind:checked={cap} class="mt-1" data-testid="daily-cap" />
      <span>
        <span class="block text-sm font-medium">Limit message emails to one per person per day</span>
        <span class="block text-xs text-fainter">
          Off by default: people without push get an email for every movement.
        </span>
      </span>
    </label>
    <div class="flex items-center gap-3">
      <button class="btn btn-primary" type="submit" data-testid="notify-save">Save</button>
      {#if form?.ok}<span class="text-xs" style="color: var(--color-accent);" data-testid="notify-saved">Saved</span>{/if}
      {#if form?.error}<span class="text-xs" style="color: var(--color-danger);">{form.error}</span>{/if}
    </div>
  </form>

  <div class="glass p-4" data-testid="notify-users">
    <h2 class="text-sm font-semibold mb-1">Per person</h2>
    <p class="text-xs text-fainter mb-3">Override the default for one person. "Receives now" is what they get at this moment.</p>
    <ul class="divide-y" style="border-color: var(--glass-border);">
      {#each data.users as u (u.id)}
        <li class="py-2.5 flex flex-wrap items-center gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-sm truncate">{u.email}</div>
            <div class="text-xs text-fainter">
              {u.role} · push {u.hasPush ? 'enabled' : 'not enabled'} · receives now:
              <span data-testid="effective-{u.id}">{effective(u)}</span>
            </div>
          </div>
          <form method="POST" action="?/user" use:enhance={() => async ({ update }) => { await update({ reset: false }); await invalidateAll(); }}>
            <input type="hidden" name="userId" value={u.id} />
            <select class="select h-9 text-xs" name="mode" aria-label="Delivery mode for {u.email}"
                    value={u.notify_mode ?? 'inherit'} data-testid="user-mode-{u.id}"
                    onchange={(e) => e.currentTarget.form?.requestSubmit()}>
              <option value="inherit">Use default</option>
              <option value="auto">Automatic</option>
              <option value="email">Email only</option>
              <option value="push">Push first</option>
            </select>
          </form>
        </li>
      {/each}
    </ul>
  </div>
</section>
