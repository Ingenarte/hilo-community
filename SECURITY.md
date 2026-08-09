# Security Policy

## Supported versions

| Version | Status |
|---------|--------|
| `0.x`   | Active — security fixes accepted on `main`. |
| `< 0.1` | Unsupported. |

Hilo follows semver; until we cut `1.0.0` API and schema may change between
minor versions. We commit to addressing security issues on the latest
`0.x` regardless.

## Reporting a vulnerability

**Do not open a public GitHub issue.** Use one of the channels below.

1. **GitHub Security Advisories** (preferred). Open a private advisory in
   this repository: *Security → Advisories → Report a vulnerability*.
2. **Email** the address listed on the maintainer's GitHub profile
   (github.com/Ingenarte) with a PGP-encrypted message if possible.

Please include:

- A description of the issue and the security impact.
- Step-by-step reproduction (curl commands, test inputs, etc.).
- Affected version / commit.
- Optionally, a proposed patch.

We'll acknowledge receipt within **72 hours** and aim for a remediation
plan within **7 days** depending on severity.

## Scope

In scope:

- Authentication and session handling (`src/lib/server/auth.ts`,
  `cookies.ts`, `magic.ts`)
- Authorisation across HTTP endpoints (anything under
  `src/routes/api/**`)
- File-upload handling (`src/lib/server/uploads.ts`)
- The IMAP poller's input parsing (`src/lib/server/imap.ts`)
- The dependency-free Web Push encryption code
  (`src/lib/server/webpush.ts`)
- Markdown rendering and any place we emit HTML from user input
  (`src/lib/format.ts`)
- The SQL query construction in `src/lib/server/tickets.ts`

Out of scope:

- Issues that require physical access to the operator's machine.
- Misconfiguration by the operator (e.g. weak `AUTH_FIXED_PASSWORD`).
- The intentionally low-security login model (shared password +
  deterministic dynamic code) — documented in the README. Reports about
  "the dynamic code is predictable" will be closed; that's the design.
- Third-party services configured by the operator (Gmail App Password,
  the Sentry / Slack / Discord endpoints, etc.).

## Security model recap

Hilo is built for "trusted guest users on a private URL". It deliberately
trades login security for ergonomics: the fixed password and the date-derived
dynamic code are designed to be **hand-distributed**, not unique per user.

Once a session exists, the rest of the system enforces ownership: only the
ticket owner, an admin, or someone in `ticket_followers` whose email
matches a Hilo user can read or reply to the thread. All of this passes
through one helper (`canAccessTicket`) so we can audit it in one place.

CSP, HSTS, frame-deny, nosniff, referrer-policy and permissions-policy are
applied to every response except SSE streams. The session cookie is
`Secure` in production and `SameSite=Lax`. Magic-link tokens are
single-use, scoped to a ticket, and 30-day TTL.

For the full breakdown see the "Security posture" section in the README.

## Hall of Fame

Once we receive credible reports, contributors get listed here (with
permission). For now: empty.
