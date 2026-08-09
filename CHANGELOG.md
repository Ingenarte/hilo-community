# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Email notifications now embed image attachments inline (CID) and render
  non-image files as chips with size + icon.
- `/api/health` endpoint for reverse proxies and uptime monitors.
- Per-user theme persistence (`users.theme`) applied to both the web UI
  (`<html data-theme>`) and the notification emails.
- Ticket priority field (`low | normal | high | urgent`) + admin filter.
- Tickets search (title + body) and pagination on the inbox.
- Markdown-style auto-link rendering in chat messages.
- Browser notifications opt-in for incoming messages.
- Admin bulk actions: close / reopen multiple tickets, CSV export.
- "Typing…" indicator via SSE.
- Rate-limiting on `/login` and `/m/<token>` (in-memory, per-IP).
- SSE auto-reconnect on transient network drops.
- Email retry queue (3 attempts, exponential backoff) when SMTP returns a
  transient failure.
- Standalone maintenance script (`scripts/cleanup.js`) for cron-driven
  pruning of expired magic links, idle sessions, and orphan uploads.
- Dockerfile, `docker-compose.yml`, Caddy / nginx / systemd templates.
- GitHub Actions CI workflow (typecheck + build + smoke-boot).

### Changed
- Session cookies use `Secure` when `NODE_ENV=production`.
- `/api/messages/<id>` now returns 415 instead of 500 when the request body
  is not `multipart/form-data` or `application/x-www-form-urlencoded`.
- Database schema is loaded via `?raw` import so production bundles ship
  without a separate `schema.sql` asset.

## [0.1.0] – 2026-05-22

### Added
- Initial release: tickets + chat, magic-link emails, SQLite storage,
  glassmorphic UI, dark theme by default.
