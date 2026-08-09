# Hilo — Local Staging Pattern

How e2e testing works in this project: local Docker staging at localhost:3001, never prod.

## Quick reference

```bash
pnpm stage:up        # build + start at http://localhost:3001
pnpm stage:seed      # populate staging DB (idempotent)
pnpm test:e2e        # run core-flow e2e tests against localhost:3001
pnpm stage:reset     # wipe DB + restart + reseed (clean state)
pnpm stage:down      # stop and remove container
pnpm stage:logs      # tail container logs
```

## Staging credentials

| Email | Password | Role |
|---|---|---|
| admin@local.test | admin-local-pw | admin |
| user@local.test | user-local-pw | user |

## What the seed creates

- Project: "Local Test" (slug: local-test)
- 3 open tickets owned by user@local.test, each with one message
- Both users are assigned to the project

## Why local staging (not prod)

E2e runs against local staging so it never touches real data. Local staging is isolated, disposable, and fast.

## Environment variables

The local staging stack (docker-compose.local.yml) sets:

| Variable | Value | Purpose |
|---|---|---|
| ADMIN_EMAIL | admin@local.test | Admin account |
| AUTH_FIXED_PASSWORD | admin-local-pw | Shared password (not used by scrypt login) |
| AUTH_DYNAMIC_FORMAT | none | Disables daily access code |
| SMTP_DRYRUN | 1 | MemoryMailer — no real emails sent |
| SESSION_SECRET | (local-only value) | Not secure, staging-only |
| DATABASE_PATH | /data/hilo.db | Inside container volume |

## Technical notes

- Stage:reset works by docker compose down -v (wipes the named volume) then up + seed.
  In-place DB deletion while the server is running does NOT work because Node holds the
  file descriptor.
- The healthcheck uses 127.0.0.1 (not localhost) because alpine's DNS resolution
  of 'localhost' may not match loopback inside the CMD-SHELL context.
- SMTP_DRYRUN=1 wires MemoryMailer in hooks.server.ts, preventing any email delivery
  from the staging stack.
