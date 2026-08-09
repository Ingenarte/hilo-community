# Contributing to Hilo

Thanks for considering contributing. Hilo's charter is **small, self-hosted,
SQLite-only, one binary**. PRs that respect that charter are welcome; PRs that
introduce Redis / Postgres / Kafka / external queues are usually not.

## Getting started

```bash
git clone https://github.com/<you>/hilo
cd hilo
cp .env.example .env             # edit values
pnpm install
pnpm dev                         # http://localhost:5180
```

## Project layout

```
src/
├── app.css                # tailwind + theme tokens
├── app.html               # server-rendered shell, applies data-theme
├── hooks.server.ts        # session resolution per request
├── lib/
│   ├── ThemeToggle.svelte # client-only dark/light toggle
│   └── server/
│       ├── auth.ts        # passwords, sessions, ddmmyy code
│       ├── cleanup.ts     # weekly maintenance routines
│       ├── cookies.ts     # centralised cookie policy
│       ├── db.ts          # better-sqlite3 + migrations
│       ├── email.ts       # nodemailer + dark/light HTML render
│       ├── env.ts         # typed env-var access
│       ├── magic.ts       # one-shot login tokens
│       ├── sse.ts         # per-ticket in-memory pub/sub
│       ├── tickets.ts     # CRUD + projects + messages
│       ├── uploads.ts     # filesystem-backed attachments
│       └── utils.ts       # shared formatters
└── routes/                # SvelteKit pages + endpoints
scripts/                   # standalone Node + bash helpers
deploy/                    # Caddyfile / systemd / nginx templates
.github/                   # CI + templates
```

## House style

- **TypeScript strict**, `svelte-check` must stay green.
- **Server modules are dependency-light**: prefer `node:*` over an extra npm
  package.
- **SOLID / DRY / KISS over clever**. If two server modules share a helper,
  put it in `src/lib/server/utils.ts`.
- **No comments restating the code.** Only document the *why* — invariants,
  workarounds, surprises.
- **Reactive primitives (Svelte 5)** — `$state`, `$derived`, `$effect`. Avoid
  `bind:` for cross-component state that flows from server data; use props
  and emit events instead.

## Tests

Run `pnpm check` (svelte-check, must report 0 / 0) and `pnpm test`
(vitest unit tests) before opening a PR. End-to-end flows are covered by
Playwright against the local staging stack: `pnpm stage:up && pnpm stage:seed
&& pnpm test:e2e` (see docs/STAGING.md).

## Commit style

- Subject in the imperative ("add", "fix", "rename"), under 70 chars.
- One topic per commit when reasonable.
- Reference the issue in the body, not the subject.

## Release flow

1. Bump `version` in `package.json`.
2. Move "Unreleased" entries in `CHANGELOG.md` under a dated heading.
3. Tag: `git tag -s vX.Y.Z -m "vX.Y.Z" && git push --tags`.

## Security disclosures

For security-relevant issues, please open a private security advisory in
GitHub rather than a public issue.

## License

By contributing you agree your changes are licensed under the project's MIT
license.
