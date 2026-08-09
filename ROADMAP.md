# Hilo Roadmap

A living document. Each item is one of:

- ✅ **Done** — shipped in the current `main` branch.
- 🟡 **In progress** — actively being worked on; PR open or imminent.
- 🟢 **Planned** — agreed in principle; no work started yet.
- 🤔 **Considering** — interesting but not yet decided.
- ❌ **Rejected** — explicitly declined; here so the same proposal
  doesn't keep coming back.

## Recently shipped

- ✅ Tickets + chat with magic-link emails
- ✅ Per-user dark/light theme + accent palette (applied to UI **and** emails)
- ✅ Multi-recipient tickets (followers + members + admins receive + write)
- ✅ Admin-curated project list (CRUD, rename, merge from `/admin`)
- ✅ Ticket priority, assignment, archive, internal notes, reactions
- ✅ Canned response templates
- ✅ Outbound webhooks (Slack / Discord / generic)
- ✅ Inbound IMAP reply-by-email
- ✅ Per-user notification window (immediate / 10 regional presets / IANA tz)
- ✅ Persistent email outbox with worker + retries
- ✅ Optional VAPID Web Push (dependency-free)
- ✅ Edit / soft-delete messages
- ✅ Markdown subset (bold, italic, code, lists, blockquote, autolink)
- ✅ Audit log + admin viewer
- ✅ Granular `/api/health` + Prometheus `/api/metrics`

## Planned next

### Quality

- 🟢 **Playwright E2E coverage** of the full demo flow (login → ticket → magic
  link → edit → react → close).
- 🟢 **OpenAPI 3.1 doc** for the ~40 REST endpoints, generated from JSDoc
  via a small build-time script.
- 🟢 **Versioned migrations** — replace the `ensureColumn()` runtime
  helper with discrete `migrations/*.sql` files indexed in a
  `schema_migrations` table.

### Features

- 🟢 **Markdown extended** — links `[]()`, images `![]()`, tables, headings,
  task-lists. No new runtime dep (extending the in-house parser).
- 🟢 **`@mention` autocomplete + push notif** — works for any participant.
- 🟢 **Notifications digest** — `digest=daily|weekly|off` per user, on top
  of the existing immediate / regional schedule.
- 🟢 **Export ticket** as a Markdown bundle (`.md` + attachments folder).
- 🟢 **CSV import** for bulk-loading existing projects.
- 🟢 **`/admin/users`** page (list / search / disable). Backend is in;
  UI pending.
- 🟢 **`/admin/audit`** UI viewer over the existing log.
- 🟢 **Outbox UI** in `/admin` — see queued / failing emails, retry, cancel.

### UX polish

- 🟢 **Avatar initials** (deterministic colour from email hash).
- 🟢 **Inbox keyboard nav** (`j` / `k` / `Enter`).
- 🟢 **Drag-resize** between chat and sidebar.
- 🟢 **Formal semantic theme tokens** (`success`, `warning`, `danger`).

### Operational

- 🟢 **In-process cleanup worker** — currently runs as a cron-invoked
  Node script.
- 🟢 **Pluggable IMAP attachment parser** without adding `mailparser`.

## Considering

- 🤔 **Foros / groups** — N-user threads paralleled to tickets, members
  + digest notifications. ~1 week of work.
- 🤔 **Mobile PWA shortcuts** (manifest `start_url` per role).
- 🤔 **Sentry SDK formal** — currently we ship a tiny envelope-only
  fallback. A real SDK adds ~30 KB; nice for stack traces.
- 🤔 **Reply-by-email rich parser** that preserves attachments + signatures.
- 🤔 **Static export of the marketing site** (Vitepress / Starlight).
- 🤔 **Markdown image uploads** stored alongside attachments.
- 🤔 **Customer-side reset for "I lost my access code"** — currently the
  operator hands out a new one out-of-band.

## Rejected

- ❌ **Multi-tenant hosted SaaS in this repo.** Charter is single-tenant
  self-hosted; multi-tenant features (org isolation, Stripe billing,
  customer onboarding) belong in a fork or sibling project.
- ❌ **Replacing SQLite with Postgres as the default.** SQLite is core to
  the charter ("two npm deps, one binary, one DB file"). Forks
  welcome.
- ❌ **Slack/Discord login.** The shared-password + dynamic-code model is
  intentional; OAuth-only login defeats the "low-friction guest URL" goal.
- ❌ **Storybook for components.** Surface is small enough to inspect in
  the live app; an extra build pipeline isn't worth it.
- ❌ **i18n of the entire UI to multiple languages out of the box.**
  English-only by spec; happy to merge a single contributor-maintained
  locale file but not a full i18n framework.

## How to propose a change

Open an issue using the **Feature request** template, then ping in your
PR. We try to keep this file up to date as proposals are accepted or
rejected.
