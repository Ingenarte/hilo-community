<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  let showCheatsheet = $state(false);
  let activeTab = $state<'shortcuts' | 'manual'>('shortcuts');
  let leader: string | null = $state(null); // for "g i", "g s" sequences
  let leaderTimer: ReturnType<typeof setTimeout> | null = null;

  function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function clearLeader() {
    leader = null;
    if (leaderTimer) clearTimeout(leaderTimer);
    leaderTimer = null;
  }

  function setLeader(k: string) {
    leader = k;
    if (leaderTimer) clearTimeout(leaderTimer);
    leaderTimer = setTimeout(() => (leader = null), 1200);
  }

  function focusSearch() {
    const el =
      document.querySelector<HTMLInputElement>('input[type="search"], input[name="q"]');
    if (el) {
      el.focus();
      el.select?.();
    } else {
      goto('/tickets');
    }
  }

  function walkTickets(delta: 1 | -1) {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[aria-label^="Open ticket"]')
    );
    if (!links.length) return;
    const idx = links.findIndex((l) => l === document.activeElement);
    const next = links[Math.max(0, Math.min(links.length - 1, idx + delta))] || links[0];
    next.focus();
  }

  function openHelp(tab: 'shortcuts' | 'manual' = 'shortcuts') {
    activeTab = tab;
    showCheatsheet = true;
  }

  function onKey(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) {
      if (e.key === 'Escape' && showCheatsheet) {
        showCheatsheet = false;
        e.preventDefault();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (leader === 'g') {
      if (e.key === 'i') { clearLeader(); goto('/tickets'); e.preventDefault(); return; }
      if (e.key === 's') { clearLeader(); goto('/admin');   e.preventDefault(); return; }
      clearLeader();
    }

    switch (e.key) {
      case '/':
        e.preventDefault();
        focusSearch();
        break;
      case 'n':
        e.preventDefault();
        goto('/tickets/new');
        break;
      case '?':
        e.preventDefault();
        if (showCheatsheet) {
          showCheatsheet = false;
        } else {
          openHelp('shortcuts');
        }
        break;
      case 'Escape':
        if (showCheatsheet) {
          showCheatsheet = false;
          e.preventDefault();
          break;
        }
        // If any other modal/dialog is open, let it handle Escape itself.
        if (typeof document !== 'undefined' && document.querySelector('[role="dialog"]')) {
          break;
        }
        // Global "back" — Escape from any inner page returns to the inbox.
        // /tickets is the root of the app for both users and admins; from
        // there Escape is a no-op so we don't push the browser out.
        if ($page.url.pathname !== '/tickets' && $page.url.pathname !== '/login') {
          e.preventDefault();
          if (typeof history !== 'undefined' && history.length > 1) {
            history.back();
          } else {
            goto('/tickets');
          }
        }
        break;
      case 'g':
        e.preventDefault();
        setLeader('g');
        break;
      case 'j':
        if ($page.url.pathname === '/tickets') { e.preventDefault(); walkTickets(1); }
        break;
      case 'k':
        if ($page.url.pathname === '/tickets') { e.preventDefault(); walkTickets(-1); }
        break;
    }
  }

  onMount(() => window.addEventListener('keydown', onKey));
  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
    if (leaderTimer) clearTimeout(leaderTimer);
  });

  const shortcuts: Array<[string, string]> = [
    ['Focus search', '/'],
    ['New ticket', 'n'],
    ['Inbox: next ticket', 'j'],
    ['Inbox: previous ticket', 'k'],
    ['Inbox: open focused', '↩'],
    ['Go to inbox', 'g i'],
    ['Go to settings', 'g s'],
    ['Send message', '⌘/Ctrl + ↩'],
    ['Back (any page) / close modal', 'Esc'],
    ['Open this help', '?']
  ];
</script>

{#if showCheatsheet}
  <div class="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:pt-20 overflow-y-auto"
       role="dialog" aria-modal="true" aria-labelledby="help-title">
    <button
      type="button"
      class="absolute inset-0 cursor-default border-0 bg-black/75 p-0"
      aria-label="Close help"
      onclick={() => (showCheatsheet = false)}
    ></button>

    <div
      class="glass-strong relative z-10 w-full max-w-2xl p-6"
      in:fly={{ y: 8, duration: 320, easing: cubicOut }}
    >
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="eyebrow mb-1">Help</div>
          <h2 id="help-title" class="text-lg font-bold tracking-tight">
            {activeTab === 'shortcuts' ? 'Keyboard shortcuts' : 'User manual'}
          </h2>
        </div>
        <button
          type="button"
          class="btn btn-ghost"
          style="height:28px; width:28px; padding:0;"
          aria-label="Close help"
          onclick={() => (showCheatsheet = false)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div role="tablist" aria-label="Help sections" class="flex gap-1 mb-5 border-b"
           style="border-color: var(--glass-border);">
        <button
          type="button"
          role="tab"
          id="tab-shortcuts"
          aria-selected={activeTab === 'shortcuts'}
          aria-controls="panel-shortcuts"
          tabindex={activeTab === 'shortcuts' ? 0 : -1}
          class="px-3 py-2 text-sm font-medium border-b-2"
          style={activeTab === 'shortcuts'
            ? 'border-color: var(--color-accent); color: var(--color-accent);'
            : 'border-color: transparent; color: var(--color-muted);'}
          onclick={() => (activeTab = 'shortcuts')}
        >Shortcuts</button>
        <button
          type="button"
          role="tab"
          id="tab-manual"
          aria-selected={activeTab === 'manual'}
          aria-controls="panel-manual"
          tabindex={activeTab === 'manual' ? 0 : -1}
          class="px-3 py-2 text-sm font-medium border-b-2"
          style={activeTab === 'manual'
            ? 'border-color: var(--color-accent); color: var(--color-accent);'
            : 'border-color: transparent; color: var(--color-muted);'}
          onclick={() => (activeTab = 'manual')}
        >User manual</button>
      </div>

      {#if activeTab === 'shortcuts'}
        <div
          id="panel-shortcuts"
          role="tabpanel"
          aria-labelledby="tab-shortcuts"
        >
          <ul class="space-y-2">
            {#each shortcuts as [label, key]}
              <li class="flex items-center justify-between text-sm">
                <span class="text-muted">{label}</span>
                <kbd class="kbd font-mono">{key}</kbd>
              </li>
            {/each}
          </ul>
          <p class="text-fainter text-xs mt-5">
            Need a feature explanation? Switch to <strong>User manual</strong>.
          </p>
        </div>
      {:else}
        <div
          id="panel-manual"
          role="tabpanel"
          aria-labelledby="tab-manual"
          class="text-sm space-y-5 max-h-[60vh] overflow-y-auto pr-1"
        >
          <section>
            <h3 class="text-base font-bold mb-1.5">Tickets</h3>
            <p class="text-muted leading-relaxed">
              A ticket is one conversation thread. It has a single owner (the
              user it represents), an optional assignee, an optional group, and
              one or more projects. Messages inside the thread are ordered
              chronologically; everyone who can see the ticket sees the same
              history.
            </p>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Status</h3>
            <ul class="text-muted leading-relaxed list-disc pl-5 space-y-1">
              <li><strong>open</strong> — active. New replies notify.</li>
              <li><strong>pending</strong> — waiting on someone else (a customer
                response, an admin action, etc).</li>
              <li><strong>closed</strong> — resolved. Reopening is allowed and
                creates a new event in the audit log.</li>
            </ul>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Priority</h3>
            <p class="text-muted leading-relaxed mb-2">
              Priority is a <strong>sorting + colouring</strong> hint. It does
              <strong>not</strong> trigger any automatic action (no escalations,
              no extra emails). It only affects:
            </p>
            <ul class="text-muted leading-relaxed list-disc pl-5 space-y-1">
              <li>The order tickets appear in the inbox (urgent → high → normal → low).</li>
              <li>The colour of the priority chip on the row.</li>
              <li>An optional visual cue for triage; treat it as a label.</li>
            </ul>
            <p class="text-muted leading-relaxed mt-2">
              Admins change the priority from the ticket detail sidebar. The
              dropdown saves immediately — no Save button.
            </p>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Projects</h3>
            <p class="text-muted leading-relaxed">
              Every ticket belongs to at least one project. Users only see
              projects an admin has assigned to them. From <em>New ticket</em>,
              a user without the project they need can type a name into
              <strong>+ Add project</strong> — that creates a new project with
              status <em>pending</em>, auto-assigns the user to it, and the
              admin can later approve, rename or archive it.
            </p>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Groups</h3>
            <p class="text-muted leading-relaxed">
              A group is a named bag of users <strong>inside a project</strong>.
              When a ticket is tagged with a group, every member of that group
              sees the ticket — in addition to its owner, assignee and CCs.
              Without a group, the ticket stays private to owner / assignee /
              followers / admins.
              Admins manage groups from <em>Admin → Groups</em>.
            </p>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Visibility — who sees what</h3>
            <ul class="text-muted leading-relaxed list-disc pl-5 space-y-1">
              <li><strong>Admin:</strong> every ticket, always.</li>
              <li><strong>Owner</strong> (the user in <code class="font-mono">tickets.user_id</code>):
                always sees their tickets.</li>
              <li><strong>Assignee</strong> (admin-set): sees the ticket.</li>
              <li><strong>CC follower</strong>: an email added to the participants
                list; sees the ticket and gets notifications.</li>
              <li><strong>Group member</strong>: sees every ticket tagged with a
                group they belong to.</li>
            </ul>
            <p class="text-muted leading-relaxed mt-2">
              Sharing a project is <strong>not</strong> enough — users in the
              same project don't see each other's tickets unless they share a
              group.
            </p>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Notifications</h3>
            <p class="text-muted leading-relaxed">
              Every new message fans out to everyone who can see the ticket
              (except the author):
            </p>
            <ul class="text-muted leading-relaxed list-disc pl-5 space-y-1 mt-1">
              <li><strong>Email</strong> — queued in the outbox, sent in your
                configured window (see Preferences).</li>
              <li><strong>Web Push</strong> — OS-level notification when the app
                isn't focused. Requires browser permission (the banner at the
                top of the page).</li>
              <li><strong>In-app</strong> — title prefix <code class="font-mono">(N) Hilo</code>,
                favicon dot, Dock/taskbar badge (installed PWA), and a short
                tone. The tone is toggleable from Preferences.</li>
            </ul>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Unread state</h3>
            <p class="text-muted leading-relaxed">
              Each ticket row in the inbox shows the count of messages you
              haven't seen. Opening the detail page marks them read after a
              short delay so the <em>NEW</em> separator + per-message pill stay
              visible long enough to notice.
            </p>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Admin features</h3>
            <ul class="text-muted leading-relaxed list-disc pl-5 space-y-1">
              <li><strong>Users</strong>: create accounts (the new user receives
                a welcome email with a generated 8-character password) and
                assign projects.</li>
              <li><strong>Groups</strong>: create, rename, delete; manage members.</li>
              <li><strong>Outbox</strong>: every email Hilo tried to send,
                successful or not.</li>
              <li><strong>Audit log</strong>: append-only timeline of
                interesting events.</li>
              <li><strong>For-user ticket creation</strong>: when admin opens
                <em>New ticket</em>, picking a user is mandatory — the ticket
                is owned by that user, not by the admin.</li>
            </ul>
          </section>

          <section>
            <h3 class="text-base font-bold mb-1.5">Refresh</h3>
            <p class="text-muted leading-relaxed">
              The icon in the navbar (top-right) re-fetches the active page.
              You shouldn't need it often — incoming activity refreshes the
              inbox automatically via SSE. Use Refresh if your connection just
              came back, or if a tab was suspended in the background for a
              long time.
            </p>
          </section>
        </div>
      {/if}
    </div>
  </div>
{/if}
