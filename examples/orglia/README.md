# Orglia

## Requirements matrix

| Requirement | Status | Evidence |
| --- | --- | --- |
| Bright multi-page business UI | Implemented | Persistent module rail, responsive detail panel, module identity colors |
| Customer → opportunity → project → order → allocation → revenue | Implemented | One server transaction creates linked project/order; inventory and booked orders drive every downstream view |
| Projects, CRM, orders, inventory | Implemented | Linked identifiers and server-guarded transitions; no client state write endpoint |
| Multi-stage internal approvals | Implemented | Create, role-checked approve/return/reject, edit, resubmit, comments, before/after audit |
| Shift wishes, constraints, suggestion, edit, publish | Implemented | Server detects unavailable/wish conflicts and blocks publishing with staffing gaps |
| Incident response and postmortem | Implemented | Severity, owner, due date, timeline, guarded escalation/resolution/postmortem transitions |
| Data-backed analytics and filters | Implemented | Revenue, pipeline, risks, badges, KPI, period/team/region filters derive from stored records |
| CSV / PDF | Implemented | Formula-injection-safe CSV; print stylesheet and system PDF destination |
| Authentication | Implemented | Password hashing, opaque server sessions, HttpOnly/SameSite cookie, rate limiting, same-origin mutation checks |
| Server RBAC and tenant isolation | Implemented | Role/tenant are derived from the session; payload tenant IDs are ignored; every mutation is re-authorized |
| Append-only audit | Implemented | Separate audit table, hash chain, server-generated actor/time/before/after; no client rewrite or delete route |
| Concurrent/shared editing | Implemented | Monotonic revision, atomic compare-and-swap, 409 conflict UI, retry, 15-second refresh |
| Failure/offline UX | Implemented | Saving, conflict, server error, and offline banners; failed commands never appear locally saved |
| Safe tenant reset | Implemented | Admin-only current-tenant reset; other tenants and prior audit events remain intact |
| Explicit/no sample data | Implemented | Visible sample banner; non-destructive startup flag; tenant-scoped CLI reset; legacy business-data localStorage removed |
| SQLite / PostgreSQL | Implemented | SQLite WAL locally; PostgreSQL row-lock transaction tested against a real Postgres 17 instance |
| Docker self-hosting | Implemented | Frozen deployment lock, non-root user, read-only filesystem, dropped capabilities, Docker secrets |
| Japanese / English | Implemented | Shell, authentication, key workflow controls, overlays, forms, filters, and `html[lang]` switch at runtime |
| WCAG 2.2 AA-oriented interaction | Implemented | Skip link, focus visibility, semantic tables, live status, dialog focus trap/Escape/restore, inert mobile background, 320px reflow |
| macOS / Windows / Linux | Implemented | Native API routes plus Main startup; the release gate requires current-source macOS, Windows x64, and Linux x64 bundle smoke tests |

Orglia is a self-hosted integrated operations example for Murasaki. Business data is server-authoritative:
the renderer receives only its authenticated tenant and sends named commands with an expected revision.

## Security model

The self-host API does not accept a tenant ID, role, actor, audit event, or replacement state from the
browser. Login creates an opaque random session whose hash is stored in the database. The cookie is
`HttpOnly` and `SameSite=Strict`. For TLS terminated by a reverse proxy, set
`ORGLIA_PUBLIC_ORIGIN=https://orglia.example.com`; this exact trusted origin is used for CSRF checks
and automatically makes the session cookie `Secure` (`COOKIE_SECURE=1` remains an explicit override).
Mutating requests also require a same-origin request marker. Forwarded headers are never trusted.

Each business command runs inside the same SQLite transaction or PostgreSQL row lock as its state
revision and audit append. Audit events carry a sequence, previous hash, event hash, server timestamp,
actor identity, and before/after values. The HTTP surface has no global clear operation and no endpoint
that writes state or audit arrays.

Seeded logins use the password supplied in `ORGLIA_BOOTSTRAP_PASSWORD`:

| Tenant | Example accounts |
| --- | --- |
| Kanto | `admin@kanto.orglia.local`, `manager@kanto.orglia.local`, `sales@kanto.orglia.local`, `operations@kanto.orglia.local`, `approver@kanto.orglia.local`, `viewer@kanto.orglia.local` |
| Kansai | `admin@kansai.orglia.local`, `sales@kansai.orglia.local` |

Development without an explicit secret uses `orglia-demo-change-me` and is intentionally unsuitable
for deployment. The packaged native demo uses that same visibly prefilled local-only credential when
no explicit secret is configured, so a downloaded sample opens without terminal setup. The standalone
self-host production server still fails closed if the bootstrap secret or secret file is missing.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build

# Local self-host server. Existing data is never replaced at startup.
ORGLIA_BOOTSTRAP_PASSWORD='use-a-long-local-secret' pnpm serve
NO_SAMPLE_DATA=1 ORGLIA_BOOTSTRAP_PASSWORD='use-a-long-local-secret' pnpm serve

# Explicit, tenant-scoped destructive data reset. Audit history is retained.
pnpm data:reset -- --tenant tn-kanto
pnpm data:reset -- --tenant tn-kanto --no-sample-data

# Native bundles
pnpm bundle
pnpm bundle:linux
pnpm exec murasaki bundle --target win32-x64
```

`NO_SAMPLE_DATA=1` and native `--no-sample-data` affect only a missing tenant. They never erase an
existing database. Native startup reads `MainContext.launch.argv` and `MainContext.launch.cwd`; with the
workspace runtime's explicit passthrough the development form is `murasaki dev -- --no-sample-data`.

## Docker

The Compose file requires secrets rather than committed defaults:

```bash
export ORGLIA_BOOTSTRAP_PASSWORD='replace-with-a-secret-manager-value'
export ORGLIA_POSTGRES_PASSWORD='replace-with-another-secret'

# SQLite at http://localhost:4173
docker compose up --build orglia

# PostgreSQL-backed Orglia at http://localhost:4174
docker compose --profile postgres up --build orglia-postgres postgres
```

For a public TLS deployment, also export the externally visible origin before
starting Compose. It must contain only scheme and host—no path, query, or credentials:

```bash
export ORGLIA_PUBLIC_ORIGIN='https://orglia.example.com'
docker compose --profile postgres up --build orglia-postgres postgres
```

The monorepo package uses `workspace:*` for `murasaki` and `@murasakijs/ui`. Docker intentionally uses
the checked-in [deployment lock](docker/pnpm-lock.yaml) for the latest published 0.54.0/0.1.0 pair and
installs with `--frozen-lockfile`; the root workspace lock is not changed. Update and re-verify this
deployment lock as a deliberate release step after a newer framework/UI pair reaches npm.

## Architecture

```text
Authenticated React / Murasaki renderer
  └─ POST /api/commands { revision, type, payload }
       ├─ session-derived tenant, user and role
       ├─ command validation + guarded state transition
       ├─ atomic revision compare-and-swap
       └─ append-only, hash-chained audit event
             ├─ SQLite WAL (single self-host instance)
             └─ PostgreSQL row lock (shared deployment)
```

The Murasaki native bundle exposes the same handlers through `src/api/**/route.ts` and initializes its
database from `src/main.ts`. The standalone Node server in `server/server.mjs` is the public self-host
entry point used by Docker.

## Verified packaging and remaining constraints

The current Murasaki 0.55 release candidate can produce macOS `.app`, Windows portable `.zip`, and Linux AppDir/AppImage; Linux
`installer` additionally produces `.deb`. Linux package signing, RPM, and repository metadata are not
implemented by the framework. The smoke-tested bundles in this example are unsigned; release builds
still require platform signing/notarization and OS-specific launch tests.

This example deliberately does not include an external IdP, MFA, password rotation/recovery UI,
backup encryption, or SIEM export. Seeded roles have tenant-wide read access while module/action writes
are role-scoped. Multi-instance deployments must use PostgreSQL; SQLite is for one process. PDF export
uses the operating system print dialog, and cross-client freshness uses revision checks plus polling
rather than WebSockets.
