<script lang="ts">
  /**
   * Ticket sidebar — metadata + admin controls + participants +
   * notification opt-in + export/back links.
   *
   * Pure presentation. Parent owns the mutations and exposes them as
   * callbacks; sidebar emits the user intent, parent does the fetch.
   *
   * Splitting this out trimmed ~125 LOC off `tickets/[id]/+page.svelte`,
   * keeping the page focused on message-list state + SSE plumbing.
   */
  import Avatar from './Avatar.svelte';
  import TicketTasks from './TicketTasks.svelte';
  import { enhance } from '$app/forms';
  import { niceDate } from './format';
  import type { NotifyState } from './notifications';

  type Task = {
    id: number;
    ticket_id: number;
    assignee_user_id: number;
    created_by_user_id: number;
    title: string;
    description: string;
    completed_at: number | null;
    completed_by_user_id: number | null;
    created_at: number;
    assignee_email: string;
    created_by_email: string;
    completed_by_email: string | null;
  };

  type Project = { id: number; name: string; slug: string };
  type AdminLite = { id: number; email: string; role?: 'user' | 'admin' };
  type Participant = {
    email: string;
    user_id: number | null;
    role: 'owner' | 'member' | 'admin' | 'cc';
  };
  type Ticket = {
    id: number;
    title: string;
    status: 'open' | 'pending' | 'closed';
    priority: 'urgent' | 'high' | 'normal' | 'low';
    user_id: number;
    user_email: string;
    assigned_to: number | null;
    group_id: number | null;
    archived_at: number | null;
    created_at: number;
    updated_at: number;
  };
  type GroupLite = { id: number; name: string; project_name: string } | null;

  type Props = {
    ticket: Ticket;
    owner: Participant | undefined;
    isAdmin: boolean;
    admins: AdminLite[];
    projects: Project[];
    allProjects: Project[];
    group: GroupLite;
    participants: Participant[];
    notifState: NotifyState;

    /** Bindable local state */
    editingProjects: boolean;
    projectDraft: number[];
    followerDraft: string;

    /** Tasks panel. The parent loads the list and tells the sidebar
        whether the viewer is allowed to create new tasks (admin or
        ticket owner). `viewerUserId` is needed by the task list so
        only the assignee or an admin can flip the done checkbox. */
    tasks: Task[];
    canCreateTask: boolean;
    viewerUserId: number;
    onTasksChanged: () => void;

    /** Callbacks (parent owns the side effects) */
    onAssign: (adminId: number | null) => void;
    onToggleArchive: () => void;
    onToggleProject: (id: number) => void;
    onSaveProjects: () => void;
    onAddFollower: () => void;
    onRemoveFollower: (email: string) => void;
    onEnableNotifs: () => void;
  };

  let {
    ticket,
    owner,
    isAdmin,
    admins,
    projects,
    allProjects,
    group,
    participants,
    notifState,
    tasks,
    canCreateTask,
    viewerUserId,
    onTasksChanged,
    editingProjects = $bindable(),
    projectDraft = $bindable(),
    followerDraft = $bindable(),
    onAssign,
    onToggleArchive,
    onToggleProject,
    onSaveProjects,
    onAddFollower,
    onRemoveFollower,
    onEnableNotifs
  }: Props = $props();
</script>

<!--
  The ticket detail page locks the document body (overflow:hidden,
  position:fixed) so iOS does not scroll the page when the on-screen
  keyboard opens on the composer. The side effect is that EVERY scroll
  container has to be local — including this sidebar, which can grow
  past the available height once a ticket accumulates tasks,
  participants, projects, etc. Mirror the chat-shell sizing math: take
  the visual viewport (`--vv-h`) minus the navbar minus the section
  padding, and scroll internally beyond that. The `pr-1` is a hair of
  right padding so the scrollbar does not overlap content.
-->
<aside
  class="space-y-3.5 overflow-y-auto thin-scroll pr-1"
  style="max-height: calc(var(--vv-h, 100dvh) - 60px - 40px); min-height: 0;"
>
  <div class="glass p-4">
    <div class="label mb-2">Ticket</div>
    <dl class="text-[12.5px] space-y-1.5">
      <div class="flex justify-between gap-3">
        <dt class="text-muted">Opened</dt>
        <dd class="font-mono text-fainter">{niceDate(ticket.created_at)}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="text-muted">Updated</dt>
        <dd class="font-mono text-fainter">{niceDate(ticket.updated_at)}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="text-muted">Author</dt>
        <dd class="truncate max-w-[160px]">{owner?.email ?? '—'}</dd>
      </div>
    </dl>
  </div>

  {#if isAdmin}
    <div class="glass p-4">
      <div class="label mb-2">Assigned to</div>
      <select
        class="select"
        value={ticket.assigned_to ?? ''}
        onchange={(e) => onAssign(Number((e.target as HTMLSelectElement).value) || null)}
      >
        <option value="">Unassigned</option>
        {#each admins as a}
          <option value={a.id}>
            {a.email}{a.role === 'admin' ? ' · admin' : ''}
          </option>
        {/each}
      </select>
    </div>

    <div class="glass p-4">
      <div class="label mb-2">Archive</div>
      <button class="btn w-full" onclick={onToggleArchive}>
        {ticket.archived_at ? 'Restore ticket' : 'Archive ticket'}
      </button>
    </div>

    <form method="POST" action="?/priority" use:enhance class="glass p-4">
      <div class="label mb-2">Priority</div>
      <select
        name="priority"
        class="select"
        value={ticket.priority}
        onchange={(e) => (e.target as HTMLSelectElement).form?.requestSubmit()}
      >
        <option value="urgent">🔥 Urgent</option>
        <option value="high">⬆️ High</option>
        <option value="normal">➖ Normal</option>
        <option value="low">⬇️ Low</option>
      </select>
    </form>
  {/if}

  {#if group}
    <div class="glass p-4">
      <div class="label mb-2">Group</div>
      <div class="text-sm">
        <span class="text-faint">{group.project_name} /</span>
        <span class="font-medium">{group.name}</span>
      </div>
      {#if isAdmin}
        <p class="text-fainter text-xs mt-1">
          Every member of this group sees this ticket.
        </p>
      {/if}
    </div>
  {/if}

  <div class="glass p-4">
    <div class="flex items-center justify-between mb-2">
      <div class="label">Projects</div>
      {#if isAdmin && !editingProjects}
        <button class="text-fainter text-xs link" onclick={() => (editingProjects = true)}>Edit</button>
      {/if}
    </div>
    {#if editingProjects}
      <div class="flex flex-wrap gap-1.5 mb-3">
        {#each allProjects as p}
          {@const active = projectDraft.includes(p.id)}
          <button
            type="button"
            class="chip"
            style={active
              ? 'background: linear-gradient(135deg, var(--color-accent), var(--color-accent-2)); color: oklch(0.15 0.04 270); border-color: transparent;'
              : ''}
            onclick={() => onToggleProject(p.id)}
          >
            {p.name}
          </button>
        {/each}
      </div>
      <div class="flex justify-end gap-2">
        <button
          class="btn btn-ghost"
          style="height:28px;"
          onclick={() => {
            editingProjects = false;
            projectDraft = projects.map((p) => p.id);
          }}>Cancel</button>
        <button class="btn btn-primary" style="height:28px;" onclick={onSaveProjects}>Save</button>
      </div>
    {:else}
      <div class="flex flex-wrap gap-1.5">
        {#if projects.length === 0}
          <span class="text-fainter text-xs">No projects</span>
        {/if}
        {#each projects as p}
          <span class="chip chip-project">{p.name}</span>
        {/each}
      </div>
    {/if}
  </div>

  <TicketTasks
    ticketId={ticket.id}
    {tasks}
    {participants}
    canCreate={canCreateTask}
    {isAdmin}
    {viewerUserId}
    onChanged={onTasksChanged}
  />

  <div class="glass p-4">
    <div class="label mb-2">Participants</div>
    <ul class="space-y-1.5 mb-3">
      {#each participants as p}
        <li class="flex items-center gap-2 text-xs">
          <Avatar email={p.email} size={20} />
          <span class="truncate flex-1">{p.email}</span>
          <span class="chip" style="height: 18px; font-size: 10px; padding: 0 6px;">{p.role}</span>
          {#if p.role !== 'owner' && p.role !== 'admin'}
            <button
              class="text-fainter hover:text-danger"
              aria-label={`Remove ${p.email}`}
              onclick={() => onRemoveFollower(p.email)}>×</button>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="flex gap-2">
      <input
        class="input"
        style="height:30px; font-size: 12px;"
        placeholder="add@example.com"
        bind:value={followerDraft}
        onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), onAddFollower())}
      />
      <button class="btn" style="height:30px;" onclick={onAddFollower}>Add</button>
    </div>
  </div>

  <div class="glass p-4">
    <div class="label mb-2">Notifications</div>
    {#if notifState === 'unsupported'}
      <p class="text-fainter text-xs">This browser doesn't support push notifications.</p>
    {:else if notifState === 'denied'}
      <!-- Warn-level emphasis so users notice their notifications are blocked -->
      <div class="flex items-start gap-2 px-2.5 py-2 rounded-lg border-l-4 text-xs"
           style="border-color: var(--color-warn); background: oklch(0.82 0.18 75 / 0.08);">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true" class="shrink-0 mt-0.5" style="color: var(--color-warn);">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        <div>
          <div class="font-semibold" style="color: var(--color-warn);">Notifications blocked</div>
          <div class="text-muted mt-0.5">Re-enable from your browser settings to get pinged on replies.</div>
        </div>
      </div>
    {:else if notifState === 'granted-on'}
      <p class="text-xs">
        <span class="text-success font-semibold">On</span> · you'll get a chirp on new messages.
      </p>
    {:else}
      <button class="btn w-full" onclick={onEnableNotifs}>Enable notifications</button>
    {/if}
  </div>

  <div class="space-y-1.5">
    <a
      class="btn btn-ghost w-full justify-start"
      href={`/api/tickets/${ticket.id}/export`}
      download
    >
      ⬇ Export as markdown
    </a>
    <a class="btn btn-ghost w-full justify-start" href="/tickets">← Back to inbox</a>
  </div>
</aside>
