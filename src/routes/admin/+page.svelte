<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Admin = { id: number; email: string };
  type Template = { id: number; title: string; body: string };
  type Webhook = {
    id: number;
    name: string;
    url: string;
    kind: 'slack' | 'discord' | 'generic';
    events: string;
    enabled: 0 | 1;
  };
  type Project = { id: number; name: string; slug: string; ticket_count: number };
  type SchedulePreset = { key: string; label: string; tz: string | null };

  type Props = {
    data: {
      admins: Admin[];
      templates: Template[];
      webhooks: Webhook[];
      projects: Project[];
      schedule: string;
      schedulePresets: SchedulePreset[];
    };
  };

  const { data }: Props = $props();

  // ---- notification schedule ----
  let busySchedule = $state(false);
  async function saveSchedule(value: string) {
    busySchedule = true;
    try {
      await fetch('/api/notify-schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schedule: value })
      });
      await invalidateAll();
    } finally {
      busySchedule = false;
    }
  }

  // ---- accent palette ----
  const ACCENTS = [
    { id: 'violet', from: 'oklch(0.74 0.18 295)', to: 'oklch(0.78 0.16 200)' },
    { id: 'cyan', from: 'oklch(0.78 0.16 200)', to: 'oklch(0.78 0.18 155)' },
    { id: 'emerald', from: 'oklch(0.78 0.18 155)', to: 'oklch(0.74 0.18 295)' },
    { id: 'amber', from: 'oklch(0.82 0.18 75)', to: 'oklch(0.7 0.22 25)' }
  ] as const;
  let currentAccent = $state<string>(
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-accent') ?? 'violet'
      : 'violet'
  );
  async function setAccent(accent: string) {
    currentAccent = accent;
    document.documentElement.setAttribute('data-accent', accent);
    await fetch('/api/accent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accent })
    });
    await invalidateAll();
  }

  // ---- admins ----
  let newAdmin = $state('');
  async function addAdmin() {
    const email = newAdmin.trim();
    if (!email) return;
    await fetch('/api/admin/admins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email })
    });
    newAdmin = '';
    await invalidateAll();
  }
  async function demoteAdmin(id: number) {
    if (!confirm('Demote this admin to user?')) return;
    await fetch('/api/admin/admins', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id })
    });
    await invalidateAll();
  }

  // ---- templates ----
  let tplTitle = $state('');
  let tplBody = $state('');
  async function addTemplate() {
    if (!tplTitle.trim() || !tplBody.trim()) return;
    await fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: tplTitle, body: tplBody })
    });
    tplTitle = '';
    tplBody = '';
    await invalidateAll();
  }
  async function deleteTemplate(id: number) {
    if (!confirm('Delete this template?')) return;
    await fetch('/api/admin/templates', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id })
    });
    await invalidateAll();
  }

  // ---- projects ----
  let newProject = $state('');
  let editingProject = $state<number | null>(null);
  let projectDraft = $state('');
  let mergeFrom = $state<number | ''>('');
  let mergeInto = $state<number | ''>('');

  async function addProject() {
    const name = newProject.trim();
    if (!name) return;
    await fetch('/api/admin/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    });
    newProject = '';
    await invalidateAll();
  }
  function startRename(p: Project) {
    editingProject = p.id;
    projectDraft = p.name;
  }
  async function commitRename() {
    if (editingProject == null) return;
    await fetch('/api/admin/projects', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: editingProject, name: projectDraft })
    });
    editingProject = null;
    await invalidateAll();
  }
  async function deleteProject(p: Project) {
    const msg =
      p.ticket_count > 0
        ? `This project still has ${p.ticket_count} ticket(s). Delete anyway? Tickets will be untagged.`
        : 'Delete this project?';
    if (!confirm(msg)) return;
    await fetch('/api/admin/projects', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: p.id, force: true })
    });
    await invalidateAll();
  }
  async function mergeProjects() {
    if (!mergeFrom || !mergeInto || mergeFrom === mergeInto) return;
    if (!confirm('Merge will move all tickets from source into target, then delete source. Proceed?')) return;
    await fetch('/api/admin/projects/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromId: mergeFrom, intoId: mergeInto })
    });
    mergeFrom = '';
    mergeInto = '';
    await invalidateAll();
  }

  // ---- webhooks ----
  let whName = $state('');
  let whUrl = $state('');
  let whKind = $state<'slack' | 'discord' | 'generic'>('slack');
  let whEvents = $state('ticket.new,ticket.urgent');
  async function addWebhook() {
    if (!whName.trim() || !whUrl.trim()) return;
    await fetch('/api/admin/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: whName, url: whUrl, kind: whKind, events: whEvents })
    });
    whName = '';
    whUrl = '';
    whEvents = 'ticket.new,ticket.urgent';
    await invalidateAll();
  }
  async function toggleWebhook(w: Webhook) {
    await fetch('/api/admin/webhooks', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: w.id, enabled: w.enabled ? 0 : 1 })
    });
    await invalidateAll();
  }
  async function deleteWebhook(id: number) {
    if (!confirm('Delete this webhook?')) return;
    await fetch('/api/admin/webhooks', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id })
    });
    await invalidateAll();
  }
</script>

<section class="max-w-6xl mx-auto px-6 py-8 lg:px-8">
  <header class="mb-6" in:fly={{ y: -8, duration: 320, easing: cubicOut }}>
    <div class="eyebrow mb-2">Settings</div>
    <h1 class="text-3xl font-bold tracking-tight mb-1.5">Admin</h1>
    <p class="text-muted text-sm">Manage admins, response templates, and outbound webhooks.</p>
  </header>

  <!-- Secondary nav -->
  <nav class="glass-subtle p-2 flex flex-wrap gap-1 mb-6 text-sm">
    <a class="btn btn-ghost btn-sm" href="/admin/users">Users</a>
    <a class="btn btn-ghost btn-sm" href="/admin/audit">Audit log</a>
    <a class="btn btn-ghost btn-sm" href="/admin/outbox">Outbox</a>
  </nav>

  <div class="grid gap-5 lg:grid-cols-2">
    <!-- 1. Notification window -->
    <section class="glass p-5 lg:col-span-2">
      <h2 class="text-base font-bold tracking-tight">Notification window</h2>
      <p class="text-muted text-sm mt-1 mb-4 max-w-2xl">
        Pick when admin emails are dispatched. Immediate sends as soon as a reply lands.
        Regional options queue messages until the next 9–18 weekday in that timezone.
      </p>
      <select
        class="select max-w-md"
        bind:value={data.schedule}
        disabled={busySchedule}
        onchange={(e) => saveSchedule((e.target as HTMLSelectElement).value)}
      >
        {#each data.schedulePresets as p}
          <option value={p.key}>{p.label}</option>
        {/each}
      </select>
    </section>

    <!-- 2. Appearance -->
    <section class="glass p-5 lg:col-span-2">
      <h2 class="text-base font-bold tracking-tight">Your appearance</h2>
      <p class="text-muted text-sm mt-1 mb-4">
        Accent palette · applies to buttons, focus rings and active chips.
      </p>
      <div class="flex flex-wrap gap-2">
        {#each ACCENTS as a}
          {@const active = currentAccent === a.id}
          <button
            type="button"
            class="btn"
            style={active
              ? 'border-color: var(--color-accent); background: var(--accent-wash);'
              : ''}
            onclick={() => setAccent(a.id)}
            aria-pressed={active}
          >
            <span
              class="inline-block w-4 h-4 rounded-full"
              style="background: linear-gradient(135deg, {a.from}, {a.to}); box-shadow: inset 0 1px 0 rgba(255,255,255,0.3);"
            ></span>
            <span class="capitalize">{a.id}</span>
          </button>
        {/each}
      </div>
    </section>

    <!-- 3. Admins -->
    <section class="glass p-5">
      <h2 class="text-base font-bold tracking-tight mb-3">Admins</h2>
      {#if data.admins.length === 0}
        <p class="text-fainter text-sm">No admins yet.</p>
      {:else}
        <ul class="space-y-1.5 mb-4">
          {#each data.admins as a}
            <li class="flex items-center gap-2 text-sm">
              <span class="flex-1 truncate font-mono text-[12.5px]">{a.email}</span>
              <button class="link text-xs" onclick={() => demoteAdmin(a.id)}>Demote</button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="flex gap-2">
        <input class="input" placeholder="new.admin@example.com"
               bind:value={newAdmin}
               onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addAdmin())} />
        <button class="btn" onclick={addAdmin}>Add</button>
      </div>
    </section>

    <!-- 4. Templates -->
    <section class="glass p-5">
      <h2 class="text-base font-bold tracking-tight mb-3">Response templates</h2>
      {#if data.templates.length === 0}
        <p class="text-fainter text-sm mb-3">No templates yet.</p>
      {:else}
        <ul class="space-y-1.5 mb-4">
          {#each data.templates as t}
            <li class="flex items-center gap-2 text-sm">
              <span class="flex-1 truncate">{t.title}</span>
              <button class="link text-xs" onclick={() => deleteTemplate(t.id)}>Delete</button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="space-y-2">
        <input class="input" placeholder="Template title (e.g. 'Investigating')"
               bind:value={tplTitle} />
        <textarea class="textarea" rows="3"
                  placeholder="Body text — supports basic markdown"
                  bind:value={tplBody}></textarea>
        <button class="btn" onclick={addTemplate}>Add template</button>
      </div>
    </section>

    <!-- 5. Projects -->
    <section class="glass p-5 lg:col-span-2">
      <h2 class="text-base font-bold tracking-tight">Projects</h2>
      <p class="text-muted text-sm mt-1 mb-4 max-w-2xl">
        Users can only tag tickets with projects from this list. Rename to fix
        typos, merge to consolidate, delete to retire.
      </p>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-fainter text-xs uppercase tracking-wider">
              <th class="font-semibold py-2 pr-3">Name</th>
              <th class="font-semibold py-2 pr-3">Slug</th>
              <th class="font-semibold py-2 pr-3 text-right">Tickets</th>
              <th class="font-semibold py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {#each data.projects as p}
              <tr style="border-top: 1px solid var(--glass-border);">
                <td class="py-2 pr-3">
                  {#if editingProject === p.id}
                    <input class="input" style="height:30px;" bind:value={projectDraft}
                           onkeydown={(e) => {
                             if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                             if (e.key === 'Escape') { editingProject = null; }
                           }} />
                  {:else}
                    <span>{p.name}</span>
                  {/if}
                </td>
                <td class="py-2 pr-3"><code class="font-mono text-fainter text-xs">{p.slug}</code></td>
                <td class="py-2 pr-3 text-right font-mono text-muted">{p.ticket_count}</td>
                <td class="py-2 pr-3 text-right">
                  {#if editingProject === p.id}
                    <button class="link text-xs mr-3" onclick={commitRename}>Save</button>
                    <button class="link text-xs" onclick={() => (editingProject = null)}>Cancel</button>
                  {:else}
                    <button class="link text-xs mr-3" onclick={() => startRename(p)}>Rename</button>
                    <button class="link text-xs" onclick={() => deleteProject(p)}>Delete</button>
                  {/if}
                </td>
              </tr>
            {/each}
            {#if data.projects.length === 0}
              <tr><td colspan="4" class="py-8 text-center text-fainter">No projects.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>

      <div class="flex gap-2 mt-4">
        <input class="input" placeholder="New project name" bind:value={newProject}
               onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addProject())} />
        <button class="btn" onclick={addProject}>Add project</button>
      </div>

      <div class="mt-6 pt-4" style="border-top: 1px solid var(--glass-border);">
        <div class="label mb-2">Merge projects</div>
        <div class="flex flex-wrap items-center gap-2">
          <select class="select w-full sm:w-auto sm:min-w-[140px]" bind:value={mergeFrom}>
            <option value="">Source…</option>
            {#each data.projects as p}<option value={p.id}>{p.name}</option>{/each}
          </select>
          <span class="text-fainter px-1">→</span>
          <select class="select w-full sm:w-auto sm:min-w-[140px]" bind:value={mergeInto}>
            <option value="">Target…</option>
            {#each data.projects as p}<option value={p.id}>{p.name}</option>{/each}
          </select>
          <button class="btn w-full sm:w-auto" onclick={mergeProjects} disabled={!mergeFrom || !mergeInto || mergeFrom === mergeInto}>
            Merge
          </button>
        </div>
      </div>
    </section>

    <!-- 6. Webhooks -->
    <section class="glass p-5 lg:col-span-2">
      <h2 class="text-base font-bold tracking-tight mb-1">Webhooks</h2>
      <p class="text-muted text-sm mb-4">Notify external services when ticket activity happens.</p>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-fainter text-xs uppercase tracking-wider">
              <th class="font-semibold py-2 pr-3">Name</th>
              <th class="font-semibold py-2 pr-3">Kind</th>
              <th class="font-semibold py-2 pr-3">Events</th>
              <th class="font-semibold py-2 pr-3 text-center">Enabled</th>
              <th class="font-semibold py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {#each data.webhooks as w}
              <tr style="border-top: 1px solid var(--glass-border);">
                <td class="py-2 pr-3">{w.name}</td>
                <td class="py-2 pr-3"><span class="chip">{w.kind}</span></td>
                <td class="py-2 pr-3"><code class="font-mono text-fainter text-xs">{w.events}</code></td>
                <td class="py-2 pr-3 text-center">
                  <input type="checkbox" checked={!!w.enabled}
                         onchange={() => toggleWebhook(w)} />
                </td>
                <td class="py-2 pr-3 text-right">
                  <button class="link text-xs" onclick={() => deleteWebhook(w.id)}>Delete</button>
                </td>
              </tr>
            {/each}
            {#if data.webhooks.length === 0}
              <tr><td colspan="5" class="py-8 text-center text-fainter">No webhooks configured.</td></tr>
            {/if}
            <tr style="border-top: 1px solid var(--glass-border);">
              <td class="py-2 pr-3"><input class="input" style="height:30px;" placeholder="name" bind:value={whName} /></td>
              <td class="py-2 pr-3"><select class="select w-auto" style="height:30px;" bind:value={whKind}>
                <option value="slack">slack</option>
                <option value="discord">discord</option>
                <option value="generic">generic</option>
              </select></td>
              <td class="py-2 pr-3"><input class="input" style="height:30px;" placeholder="ticket.new,ticket.urgent" bind:value={whEvents} /></td>
              <td></td>
              <td class="py-2 pr-3 text-right"><button class="btn btn-sm" onclick={addWebhook}>Add</button></td>
            </tr>
            <tr><td colspan="5" class="py-2 pr-3">
              <input class="input" placeholder="https://hooks.slack.com/services/…" bind:value={whUrl} />
            </td></tr>
          </tbody>
        </table>
      </div>

      <p class="text-fainter text-xs mt-3">
        Available events:
        <code class="font-mono">ticket.new</code>,
        <code class="font-mono">ticket.reply</code>,
        <code class="font-mono">ticket.urgent</code>,
        <code class="font-mono">ticket.closed</code>,
        <code class="font-mono">ticket.assigned</code>
      </p>
    </section>
  </div>
</section>
