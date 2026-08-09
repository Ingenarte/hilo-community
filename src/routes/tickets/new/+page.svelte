<script lang="ts">
  import { enhance } from '$app/forms';
  import { fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { fmtBytes } from '$lib/format';

  type Project = { id: number; name: string; slug: string };
  type UserOption = { id: number; email: string };
  type GroupOption = { id: number; name: string; project_id: number; project_name: string };

  type Props = {
    data: { projects: Project[]; users: UserOption[]; groups: GroupOption[] };
    form?: { error?: string; title?: string; body?: string } | null;
  };

  const { data, form }: Props = $props();

  // Admin-only: the ticket owner (defaults to the admin themselves).
  // Regular users don't see this picker and `userId` stays unset.
  let assignedUserId = $state<number | ''>('');
  let selectedGroupId = $state<number | ''>('');

  // The Group dropdown is filtered by whichever projects the user has
  // ticked. If no project is selected yet, no group is offered.
  const availableGroups = $derived(
    data.groups.filter((g) =>
      data.projects.some((p) => selected.includes(p.name) && p.id === g.project_id)
    )
  );
  // If the previously-selected group no longer matches the active
  // projects, drop it so an invalid combination can't be submitted.
  $effect(() => {
    if (selectedGroupId !== '' && !availableGroups.some((g) => g.id === selectedGroupId)) {
      selectedGroupId = '';
    }
  });

  let selected = $state<string[]>([]);
  let submitting = $state(false);
  let files = $state<File[]>([]);
  let dragging = $state(false);
  let customProjects = $state<string[]>([]);
  let addingCustom = $state(false);
  let customDraft = $state('');
  let customError = $state<string | null>(null);
  let customInput: HTMLInputElement | null = $state(null);

  function toggleProject(name: string) {
    selected = selected.includes(name)
      ? selected.filter((n) => n !== name)
      : [...selected, name];
  }

  function startAddingCustom() {
    addingCustom = true;
    customError = null;
    customDraft = '';
    queueMicrotask(() => customInput?.focus());
  }

  function cancelCustom() {
    addingCustom = false;
    customDraft = '';
    customError = null;
  }

  function confirmCustom() {
    const name = customDraft.trim();
    if (!name) {
      cancelCustom();
      return;
    }
    if (name.length > 80) {
      customError = 'Max 80 characters.';
      return;
    }
    const lower = name.toLowerCase();
    const dupExisting = data.projects.some((p) => p.name.toLowerCase() === lower);
    const dupCustom = customProjects.some((n) => n.toLowerCase() === lower);
    if (dupExisting || dupCustom) {
      // Don't create a duplicate — just select it.
      const canonical = dupExisting
        ? data.projects.find((p) => p.name.toLowerCase() === lower)!.name
        : customProjects.find((n) => n.toLowerCase() === lower)!;
      if (!selected.includes(canonical)) selected = [...selected, canonical];
      cancelCustom();
      return;
    }
    customProjects = [...customProjects, name];
    selected = [...selected, name];
    cancelCustom();
  }

  function removeCustom(name: string) {
    customProjects = customProjects.filter((n) => n !== name);
    selected = selected.filter((n) => n !== name);
  }

  function onCustomKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmCustom();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCustom();
    }
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) return;
    files = [...files, ...Array.from(input.files)];
    // Clear the native input so a second pick appends instead of replacing.
    // The JS `files` state holds the real list; we inject it into FormData
    // at submit time via the use:enhance callback below.
    input.value = '';
  }

  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dragging = true;
    }
  }

  function onDragLeave(e: DragEvent) {
    // Only clear when leaving the form element itself, not a child.
    if (e.currentTarget === e.target) dragging = false;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files) {
      files = [...files, ...Array.from(e.dataTransfer.files)];
    }
  }

  function removeFile(i: number) {
    files = files.filter((_, idx) => idx !== i);
  }

</script>

<section class="max-w-2xl mx-auto px-6 py-10">
  <header class="mb-6" in:fly={{ y: -8, duration: 320, easing: cubicOut }}>
    <div class="eyebrow mb-2">Start a thread</div>
    <h1 class="text-3xl font-bold tracking-tight mb-1.5">New ticket</h1>
    <p class="text-faint text-sm max-w-lg">
      One ticket per topic. You'll get an email every time the admin replies.
    </p>
  </header>

  <form
    method="POST"
    enctype="multipart/form-data"
    class="glass p-6 sm:p-7 space-y-5 transition-colors"
    style={dragging ? 'outline: 2px solid var(--color-accent); outline-offset: 2px;' : ''}
    in:scale={{ start: 0.97, duration: 380, opacity: 0, easing: cubicOut }}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    use:enhance={({ formData }) => {
      // The native <input type="file"> is intentionally cleared after every
      // pick so a second pick appends instead of replacing. That leaves an
      // empty `files` entry in the serialized form; rebuild it from JS state.
      formData.delete('files');
      for (const f of files) formData.append('files', f);

      submitting = true;
      return async ({ update }) => {
        await update({ reset: false });
        submitting = false;
      };
    }}
  >
    <div>
      <label for="title" class="label block mb-2">Title</label>
      <input
        id="title"
        name="title"
        required
        maxlength="200"
        class="input"
        placeholder="Short summary"
        value={form?.title ?? ''}
      />
    </div>

    {#if data.users.length > 0}
      <div>
        <label for="userId" class="label block mb-2">For user *</label>
        <select
          id="userId"
          name="userId"
          class="input"
          required
          bind:value={assignedUserId}
        >
          <option value="" disabled>— Select a user —</option>
          {#each data.users as u}
            <option value={u.id}>{u.email}</option>
          {/each}
        </select>
        <p class="text-fainter text-xs mt-1">
          The picked user becomes the ticket owner. Other users in the same project will not see this ticket unless they share a group with it.
        </p>
      </div>

      <div>
        <label for="groupId" class="label block mb-2">Group (optional)</label>
        <select
          id="groupId"
          name="groupId"
          class="input"
          disabled={availableGroups.length === 0}
          bind:value={selectedGroupId}
        >
          <option value="">— No group —</option>
          {#each availableGroups as g}
            <option value={g.id}>{g.project_name} / {g.name}</option>
          {/each}
        </select>
        <p class="text-fainter text-xs mt-1">
          {#if availableGroups.length === 0}
            Pick a project first, or create a group from <a href="/admin/groups" class="underline">Admin → Groups</a>.
          {:else}
            Every member of the selected group will see this ticket.
          {/if}
        </p>
      </div>
    {/if}

    <div>
      <span class="label block mb-2">Project</span>
      <div class="flex flex-wrap gap-2 items-center">
        {#each data.projects as p}
          {@const active = selected.includes(p.name)}
          <button
            type="button"
            class="chip transition-all duration-200"
            class:chip-project={!active}
            onclick={() => toggleProject(p.name)}
            style={active
              ? 'background: linear-gradient(135deg, var(--color-accent), var(--color-accent-2)); color: oklch(0.15 0.04 270); border-color: transparent; transform: scale(1.04); height: 26px; padding: 0 12px;'
              : 'height: 26px; padding: 0 12px;'}
            aria-pressed={active}
          >
            {p.name}
          </button>
        {/each}

        {#each customProjects as name}
          {@const active = selected.includes(name)}
          <span class="inline-flex items-center gap-1">
            <button
              type="button"
              class="chip transition-all duration-200"
              class:chip-project={!active}
              onclick={() => toggleProject(name)}
              style={active
                ? 'background: linear-gradient(135deg, var(--color-accent), var(--color-accent-2)); color: oklch(0.15 0.04 270); border-color: transparent; transform: scale(1.04); height: 26px; padding: 0 12px 0 12px;'
                : 'height: 26px; padding: 0 12px;'}
              aria-pressed={active}
            >
              {name}
            </button>
            <button
              type="button"
              class="text-fainter hover:text-danger transition-colors"
              style="font-size: 14px; line-height: 1; padding: 2px 4px;"
              onclick={() => removeCustom(name)}
              aria-label={`Remove ${name}`}
              title="Remove"
            >×</button>
          </span>
        {/each}

        {#if addingCustom}
          <span class="inline-flex items-center gap-1">
            <input
              bind:this={customInput}
              bind:value={customDraft}
              onkeydown={onCustomKey}
              onblur={confirmCustom}
              placeholder="Project name"
              maxlength="80"
              class="input"
              style="height: 26px; padding: 0 10px; font-size: 0.75rem; width: 160px;"
              aria-label="New project name"
            />
          </span>
        {:else}
          <button
            type="button"
            class="chip transition-all duration-200"
            onclick={startAddingCustom}
            style="height: 26px; padding: 0 10px; border-style: dashed; color: var(--color-muted);"
            aria-label="Add custom project"
            title="Add a project not in the list"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="3" stroke-linecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add
          </button>
        {/if}
      </div>

      {#if customError}
        <p class="text-xs mt-2" style="color: var(--color-danger);">{customError}</p>
      {/if}

      {#if data.projects.length === 0 && customProjects.length === 0}
        <p class="text-fainter text-xs mt-2">
          No projects yet — type one with the <span class="font-semibold">+ Add</span> button or leave blank and the admin will tag it.
        </p>
      {:else}
        <p class="text-fainter text-xs mt-2">
          Don't see your project? Use <span class="font-semibold">+ Add</span> — the admin can rename it later.
        </p>
      {/if}

      {#each selected as name}
        <input type="hidden" name="projects" value={name} />
      {/each}
    </div>

    <div>
      <label for="body" class="label block mb-2">First message</label>
      <textarea
        id="body"
        name="body"
        required
        rows="6"
        class="textarea"
        placeholder="Describe the issue or the feedback you'd like to share…"
        >{form?.body ?? ''}</textarea>
    </div>

    <div>
      <span class="label block mb-2">Attachments <span class="text-fainter normal-case font-normal">(optional)</span></span>
      <label class="glass-subtle flex items-center gap-3 px-3.5 py-3 cursor-pointer hover:opacity-90 transition-opacity">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             style="color: var(--color-accent);" aria-hidden="true">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        <span class="text-sm font-medium whitespace-nowrap">Attach files</span>
        <span class="text-fainter text-xs whitespace-nowrap">max 20 MB each</span>
        <input type="file" name="files" multiple class="hidden" onchange={onFileChange} />
      </label>

      {#if files.length}
        <ul class="flex flex-wrap gap-2 mt-3">
          {#each files as f, i}
            <li class="glass-subtle inline-flex items-center gap-2 px-2.5 py-1.5 text-xs">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                   style="color: var(--color-muted);" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span class="font-medium">{f.name}</span>
              <span class="text-fainter font-mono">{fmtBytes(f.size)}</span>
              <button type="button" class="text-fainter hover:text-danger ml-1"
                      onclick={() => removeFile(i)} aria-label={`Remove ${f.name}`}>×</button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if form?.error}
      <div
        class="rounded-xl px-3 py-2.5 text-sm error-bubble"
        in:fly={{ y: -6, duration: 220, easing: cubicOut }}
        role="alert"
      >
        {form.error}
      </div>
    {/if}

    <footer class="flex items-center justify-between pt-2">
      <a href="/tickets" class="btn btn-ghost">Cancel</a>
      <button type="submit" class="btn btn-primary" disabled={submitting}>
        {#if submitting}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" class="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Creating…
        {:else}
          Create ticket
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        {/if}
      </button>
    </footer>
  </form>
</section>
