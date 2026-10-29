<script lang="ts">
	/**
	 * Pending tasks panel inside the ticket sidebar.
	 *
	 * - Lists open tasks first, completed tasks at the bottom (faded +
	 *   strikethrough).
	 * - Shows an "Add task" affordance to admins and to the ticket owner.
	 * - The assignee or any admin can toggle the done checkbox.
	 * - Admins can delete tasks.
	 *
	 * Parent owns:
	 *   - `data.tasks`        — current list (re-loaded by invalidateAll
	 *                            on SSE 'task' events).
	 *   - `participants`      — used to populate the assignee dropdown.
	 *   - `canCreate`         — whether the viewer can open the create form.
	 *   - `viewerUserId` / `isAdmin` — gate Done / Delete buttons.
	 *   - `ticketId`          — used by the API endpoints.
	 *
	 * The component fires its own fetches against /api/tickets/[id]/tasks
	 * and /api/tasks/[id] and then calls `onChanged()` so the parent can
	 * `invalidateAll()` and the SSE broadcast can re-fan-out.
	 */
	import { tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	type Participant = {
		email: string;
		user_id: number | null;
		role: 'owner' | 'member' | 'admin' | 'cc';
	};

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

	type Props = {
		ticketId: number;
		tasks: Task[];
		participants: Participant[];
		canCreate: boolean;
		isAdmin: boolean;
		viewerUserId: number;
		onChanged: () => void;
		/** Render without its own card (inside a sectioned panel). */
		embedded?: boolean;
	};

	const {
		ticketId,
		tasks,
		participants,
		canCreate,
		isAdmin,
		viewerUserId,
		onChanged,
		embedded = false
	}: Props = $props();

	let showAdd = $state(false);
	let draftTitle = $state('');
	let draftDescription = $state('');
	let draftAssigneeId = $state<number | ''>('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let titleRef = $state<HTMLInputElement | null>(null);

	const assignableParticipants = $derived(
		participants.filter((p): p is Participant & { user_id: number } => p.user_id !== null)
	);

	async function openAdd() {
		showAdd = true;
		draftTitle = '';
		draftDescription = '';
		draftAssigneeId = assignableParticipants[0]?.user_id ?? '';
		error = null;
		await tick();
		titleRef?.focus();
	}

	function closeAdd() {
		showAdd = false;
	}

	async function submitAdd(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		const title = draftTitle.trim();
		if (!title) {
			error = 'Title is required.';
			return;
		}
		if (typeof draftAssigneeId !== 'number') {
			error = 'Pick an assignee.';
			return;
		}
		busy = true;
		try {
			const r = await fetch(`/api/tickets/${ticketId}/tasks`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					assignee_user_id: draftAssigneeId,
					title,
					description: draftDescription.trim()
				})
			});
			if (!r.ok) {
				const body = await r.json().catch(() => ({}));
				throw new Error(body.message || body.error || `HTTP ${r.status}`);
			}
			showAdd = false;
			onChanged();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create task.';
		} finally {
			busy = false;
		}
	}

	async function toggleDone(task: Task) {
		const next = task.completed_at == null;
		try {
			const r = await fetch(`/api/tasks/${task.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ completed: next })
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			onChanged();
		} catch {
			// silent — SSE broadcast will resync if the toggle landed remotely
		}
	}

	async function remove(task: Task) {
		if (!confirm(`Delete task "${task.title}"?`)) return;
		try {
			const r = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			onChanged();
		} catch {
			/* SSE will resync */
		}
	}

	function shortLabel(email: string): string {
		const at = email.indexOf('@');
		return at > 0 ? email.slice(0, at) : email;
	}

	function canToggle(task: Task): boolean {
		return isAdmin || task.assignee_user_id === viewerUserId;
	}
</script>

<div class={embedded ? '' : 'glass p-4'}>
	<div class="flex items-center justify-between mb-2">
		<div class="label">Tasks</div>
		{#if canCreate}
			<button type="button" class="link text-xs" onclick={openAdd}>+ Add task</button>
		{/if}
	</div>

	{#if tasks.length === 0}
		<p class="text-fainter text-[12px]">No tasks yet.</p>
	{:else}
		<ul class="space-y-2.5">
			{#each tasks as t (t.id)}
				{@const done = t.completed_at != null}
				{@const mine = t.assignee_user_id === viewerUserId}
				<li class="flex items-start gap-2 text-[12.5px] leading-snug relative"
					class:tk-task-mine={mine && !done}
					style:opacity={done ? '0.55' : '1'}>
					<button
						type="button"
						class="mt-0.5 shrink-0 inline-flex items-center justify-center"
						style="width:18px; height:18px; border-radius:4px;
						       border:1.5px solid var(--glass-border-strong);
						       {done ? 'background: var(--color-accent); border-color: transparent;' : ''}"
						aria-label={done ? 'Mark as pending' : 'Mark as done'}
						aria-pressed={done}
						disabled={!canToggle(t)}
						onclick={() => toggleDone(t)}
					>
						{#if done}
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none"
								 stroke="oklch(0.15 0.04 270)" stroke-width="3"
								 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12" />
							</svg>
						{/if}
					</button>

					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-1.5 flex-wrap">
							<div class="font-medium" style:text-decoration={done ? 'line-through' : 'none'}>
								{t.title}
							</div>
							{#if mine && !done}
								<!--
									Bright "YOU" pill next to the title so the viewer can
									tell at a glance which tasks they own without parsing
									the assignee email at the bottom of the row.
								-->
								<span
									class="inline-flex items-center font-bold"
									style="font-size: 9px; line-height: 1; letter-spacing: 0.12em;
									       padding: 2px 5px; border-radius: 999px;
									       background: linear-gradient(135deg, oklch(0.82 0.18 75), oklch(0.7 0.22 25));
									       color: oklch(0.15 0.04 270);"
									aria-label="Assigned to you"
								>
									YOU
								</span>
							{/if}
						</div>
						{#if t.description}
							<div class="text-muted text-[11.5px] mt-0.5 leading-snug" style="white-space: pre-wrap;">
								{t.description}
							</div>
						{/if}
						<div class="text-fainter text-[10.5px] mt-1">
							[{shortLabel(t.assignee_email)}] · by {shortLabel(t.created_by_email)}
							{#if done && t.completed_by_email}
								· done by {shortLabel(t.completed_by_email)}
							{/if}
						</div>
					</div>

					{#if isAdmin}
						<button
							type="button"
							class="text-fainter hover:text-danger shrink-0"
							style="font-size: 14px; line-height: 1; padding: 2px 4px;"
							aria-label="Delete task"
							onclick={() => remove(t)}
						>×</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

{#if showAdd}
	<div
		class="fixed inset-0 z-[200] flex items-start justify-center px-4 pb-4 overflow-y-auto"
		style="padding-top: 10vh;"
		role="dialog"
		aria-modal="true"
		aria-labelledby="task-add-title"
		transition:fade={{ duration: 160 }}
	>
		<button
			type="button"
			class="absolute inset-0 cursor-default border-0 bg-black/55 p-0"
			aria-label="Dismiss"
			tabindex="-1"
			onclick={closeAdd}
		></button>

		<form
			class="glass-strong relative z-10 w-full max-w-md p-5 rounded-xl flex flex-col gap-3"
			style="padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));"
			transition:fly={{ y: 12, duration: 200, easing: cubicOut }}
			onsubmit={submitAdd}
		>
			<h2 id="task-add-title" class="text-base font-semibold tracking-tight">New task</h2>

			<label class="flex flex-col gap-1">
				<span class="text-xs text-muted">Assignee</span>
				<select class="input" bind:value={draftAssigneeId} disabled={busy} required>
					{#each assignableParticipants as p}
						<option value={p.user_id}>{p.email} · {p.role}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-xs text-muted">Title</span>
				<input
					bind:this={titleRef}
					type="text"
					class="input"
					placeholder="What needs to be done?"
					bind:value={draftTitle}
					maxlength="120"
					required
					disabled={busy}
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-xs text-muted">Description <span class="text-fainter">(optional)</span></span>
				<textarea
					class="textarea"
					rows="3"
					placeholder="Context, links, repro steps…"
					bind:value={draftDescription}
					maxlength="2000"
					disabled={busy}
				></textarea>
			</label>

			{#if error}
				<p class="text-xs" style="color: var(--color-danger);">{error}</p>
			{/if}

			<div class="flex justify-end gap-2 mt-1">
				<button type="button" class="btn" onclick={closeAdd} disabled={busy}>Cancel</button>
				<button type="submit" class="btn btn-primary" disabled={busy}>
					{busy ? 'Saving…' : 'Add task'}
				</button>
			</div>
		</form>
	</div>
{/if}

<style>
	/*
	 * Mine-task highlight: a thin amber accent at the very left edge plus
	 * a subtle background tint. Same gradient as the inbox `.tk-task`
	 * stripe so the "this is yours" signal is consistent from the inbox
	 * to the sidebar.
	 */
	.tk-task-mine {
		padding-left: 8px;
		background: oklch(0.82 0.18 75 / 0.06);
		border-radius: 8px;
	}
	.tk-task-mine::before {
		content: '';
		position: absolute;
		left: 0;
		top: 4px;
		bottom: 4px;
		width: 3px;
		background: linear-gradient(180deg, oklch(0.82 0.18 75), oklch(0.7 0.22 25));
		border-radius: 2px;
		pointer-events: none;
	}
	:global(:root[data-theme="light"]) .tk-task-mine {
		background: oklch(0.82 0.18 75 / 0.1);
	}
</style>
