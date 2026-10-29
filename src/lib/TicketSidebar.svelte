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
  import { onMount } from 'svelte';
  import UrgentReasonModal from './UrgentReasonModal.svelte';
  import AgentTokenModal from './AgentTokenModal.svelte';
  import {
    PRIORITY_LABEL,
    PRIORITY_ORDER,
    SLA_HOURS,
    formatRemaining,
    slaTone,
    type Priority
  } from './sla';

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
    priority: Priority;
    priority_reason: string | null;
    sla_due_at: number | null;
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
    /** Past extension requests of this ticket, newest first. */
    extensions: Array<{ id: number; hours: number; reason: string; created_at: number; user_email: string | null }>;
    /** Opens the "Extend time" dialog owned by the page. */
    onExtend: () => void;
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
    onEnableNotifs,
    extensions,
    onExtend
  }: Props = $props();

  // ── Priority + response-time target (any user with access can change it) ──
  let priorityForm = $state<HTMLFormElement | null>(null);
  let prioritySelect = $state<HTMLSelectElement | null>(null);
  let urgentModalOpen = $state(false);
  let agentTokenOpen = $state(false);
  let hiddenReason = $state('');
  let hiddenConfirm = $state('');
  let priorityError = $state<string | null>(null);
  let nowSec = $state(Math.floor(Date.now() / 1000));

  onMount(() => {
    const t = setInterval(() => (nowSec = Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  });

  const remainingText = $derived(formatRemaining(ticket.sla_due_at, nowSec));
  const tone = $derived(slaTone(ticket.sla_due_at, ticket.priority, nowSec));

  function submitPriority(next: Priority, reason: string, confirm: string) {
    if (!prioritySelect || !priorityForm) return;
    prioritySelect.value = next;
    hiddenReason = reason;
    hiddenConfirm = confirm;
    priorityError = null;
    // Let the hidden inputs pick up the new values before the form serialises.
    queueMicrotask(() => priorityForm?.requestSubmit());
  }

  function onPriorityChange(e: Event) {
    const el = e.target as HTMLSelectElement;
    const next = el.value as Priority;
    if (next === ticket.priority) return;
    if (next === 'urgent') {
      el.value = ticket.priority; // stay on the current value until confirmed
      urgentModalOpen = true;
      return;
    }
    submitPriority(next, '', '');
  }

  /** Segmented control handler: same rules as the select change. */
  function pickPriority(next: Priority) {
    if (next === ticket.priority) return;
    if (next === 'urgent') {
      urgentModalOpen = true;
      return;
    }
    submitPriority(next, '', '');
  }

  function onUrgentConfirmed(reason: string) {
    urgentModalOpen = false;
    submitPriority('urgent', reason, '1');
  }
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
  class="overflow-y-auto thin-scroll pr-1"
  style="max-height: calc(var(--vv-h, 100dvh) - 60px - 40px); min-height: 0;"
>
<div class="glass" style="padding: 0;">
  <div class="panel-section">
    <div class="label mb-2">Ticket</div>
    <dl class="text-[12.5px] space-y-1.5">
      <div class="flex justify-between gap-3">
        <dt class="text-muted">Opened</dt>
        <dd class="num text-fainter">{niceDate(ticket.created_at)}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="text-muted">Updated</dt>
        <dd class="num text-fainter">{niceDate(ticket.updated_at)}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="text-muted">Author</dt>
        <dd class="truncate max-w-[160px]">{owner?.email ?? '-'}</dd>
      </div>
    </dl>
  </div>

  <div class="panel-section">
    <div class="flex items-center justify-between mb-2">
      <div class="label">Priority</div>
      <span class="num text-[12px] font-medium sla-{tone}" data-testid="sla-remaining">{remainingText}</span>
    </div>
    <form
      bind:this={priorityForm}
      method="POST"
      action="?/priority"
      use:enhance={() => async ({ result, update }) => {
        if (result.type === 'failure') {
          priorityError = (result.data?.priorityError as string) ?? 'Could not change the priority.';
        }
        await update({ reset: false });
        if (prioritySelect) prioritySelect.value = ticket.priority;
      }}
    >
      <!-- The select stays in the DOM (it is what the form posts) but the
           segmented control below is the visible affordance. -->
      <select
        bind:this={prioritySelect}
        name="priority"
        class="sr-only"
        tabindex="-1"
        value={ticket.priority}
        onchange={onPriorityChange}
        aria-label="Priority"
      >
        {#each PRIORITY_ORDER as p}
          <option value={p}>{PRIORITY_LABEL[p]} · {SLA_HOURS[p]}h</option>
        {/each}
      </select>
      <input type="hidden" name="reason" value={hiddenReason} />
      <input type="hidden" name="confirmUrgent" value={hiddenConfirm} />
    </form>
    <div class="segmented" role="group" aria-label="Priority">
      {#each PRIORITY_ORDER as p}
        <button
          type="button"
          class="segmented-item"
          data-tone={p}
          aria-pressed={ticket.priority === p}
          title={`${PRIORITY_LABEL[p]}: ${SLA_HOURS[p]} h response target`}
          data-testid={`priority-${p}`}
          onclick={() => pickPriority(p)}
        >{PRIORITY_LABEL[p]}</button>
      {/each}
    </div>
    <p class="text-[11px] text-fainter mt-2" data-testid="sla-hint">
      {SLA_HOURS[ticket.priority]} h target. The clock restarts with every message, from either side.
    </p>
    {#if ticket.status !== 'closed' && ticket.sla_due_at != null}
      <button type="button" class="btn btn-sm w-full mt-2.5" onclick={onExtend}
              data-testid="extend-time">
        Extend time
      </button>
    {/if}
    {#if extensions.length > 0}
      <ul class="mt-3 space-y-2 text-xs" data-testid="extension-history">
        {#each extensions.slice(0, 3) as x (x.id)}
          <li class="rounded-lg px-2.5 py-1.5" style="background: var(--accent-wash);">
            <div class="text-muted">
              <strong class="num">+{x.hours} h</strong> · {x.user_email ?? 'someone'} · <span class="num">{niceDate(x.created_at)}</span>
            </div>
            <div class="mt-0.5 break-words">{x.reason}</div>
          </li>
        {/each}
        {#if extensions.length > 3}
          <li class="text-fainter">and {extensions.length - 3} earlier</li>
        {/if}
      </ul>
    {/if}
    {#if ticket.priority === 'urgent' && ticket.priority_reason}
      <p class="text-xs mt-2" style="color: var(--color-danger);" data-testid="urgent-reason">
        Urgent: {ticket.priority_reason}
      </p>
    {/if}
    {#if priorityError}
      <p class="text-xs mt-2" style="color: var(--color-danger);" role="alert">{priorityError}</p>
    {/if}
  </div>

  {#if isAdmin}
    <div class="panel-section">
      <div class="label mb-2">Assigned to</div>
      <select
        class="select"
        aria-label="Assigned to"
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
  {/if}

  {#if group}
    <div class="panel-section">
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

  <div class="panel-section">
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
              ? 'background: var(--color-accent); color: var(--color-on-accent); border-color: transparent;'
              : ''}
            aria-pressed={active}
            onclick={() => onToggleProject(p.id)}
          >
            {p.name}
          </button>
        {/each}
      </div>
      <div class="flex justify-end gap-2">
        <button
          class="btn btn-ghost btn-xs"
          onclick={() => {
            editingProjects = false;
            projectDraft = projects.map((p) => p.id);
          }}>Cancel</button>
        <button class="btn btn-primary btn-xs" onclick={onSaveProjects}>Save</button>
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

  <div class="panel-section">
    <TicketTasks
      ticketId={ticket.id}
      {tasks}
      {participants}
      canCreate={canCreateTask}
      {isAdmin}
      {viewerUserId}
      onChanged={onTasksChanged}
      embedded
    />
  </div>

  <div class="panel-section">
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
        style="height:32px; font-size: 12px;"
        placeholder="add@example.com"
        bind:value={followerDraft}
        onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), onAddFollower())}
      />
      <button class="btn btn-sm" onclick={onAddFollower}>Add</button>
    </div>
  </div>

  <div class="panel-section">
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
      <button class="btn btn-sm w-full" onclick={onEnableNotifs}>Enable notifications</button>
    {/if}
  </div>

  <div class="panel-section">
    <div class="label mb-2">Agent access</div>
    <p class="text-xs text-muted mb-2.5 leading-relaxed">
      Give a coding agent a 96-hour token to read this ticket, work on it and write a short reply.
    </p>
    <button type="button" class="btn btn-sm w-full" onclick={() => (agentTokenOpen = true)}>
      Generate agent token
    </button>
  </div>

  <div class="panel-section">
    <div class="flex items-center gap-1.5" role="group" aria-label="Export ticket">
      <span class="label mr-auto">Export</span>
      <a
        class="btn btn-ghost btn-xs"
        href={`/api/tickets/${ticket.id}/export?format=md`}
        download
        title="Markdown. A ZIP with the images and audio when the ticket has attachments."
      >MD</a>
      <a class="btn btn-ghost btn-xs" href={`/api/tickets/${ticket.id}/export?format=pdf`} download title="PDF with images">PDF</a>
      <a class="btn btn-ghost btn-xs" href={`/api/tickets/${ticket.id}/export?format=docx`} download title="Word document with images">DOCX</a>
    </div>
    {#if isAdmin}
      <button class="btn btn-ghost btn-sm w-full justify-start mt-2 -ml-1" onclick={onToggleArchive}
              style="color: var(--color-muted);">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="5" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <line x1="10" y1="13" x2="14" y2="13" />
        </svg>
        {ticket.archived_at ? 'Restore ticket' : 'Archive ticket'}
      </button>
    {/if}
  </div>
</div>

<UrgentReasonModal
  open={urgentModalOpen}
  onconfirm={onUrgentConfirmed}
  oncancel={() => (urgentModalOpen = false)}
/>

<AgentTokenModal
  open={agentTokenOpen}
  ticketId={ticket.id}
  onclose={() => (agentTokenOpen = false)}
/>
</aside>
