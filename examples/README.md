# Murasaki reference applications

[日本語](./README.ja.md)

These applications are product-shaped verification targets for Murasaki. They
are not static UI galleries, benchmark-only projects, or screenshots backed by
hard-coded activity. Each application must remain useful when sample data is
disabled and must exercise real storage, process, network, and packaging paths.

## Applications

| Application | Audience | Product | Primary framework proof |
| --- | --- | --- | --- |
| [Papelle](./papelle) | Individuals | Local-first block knowledge workspace | Files, SQLite, Node Main, offline state, attachments, import/export, optional self-hosted collaboration |
| [Oscilla](./oscilla) | Developers | API testing, automation, and log workbench | Real HTTP/GraphQL/WebSocket traffic, secure storage, long-running processes, file and Docker streams, local mock server |
| [Orglia](./orglia) | Organizations | Self-hosted multi-module operations suite | Multi-page application, relational workflows, RBAC, audit records, PostgreSQL synchronization, reports and exports |

The three products have independent names, icons, color systems, information
architecture, and data models. Murasaki is the framework they share, not their
visible product brand.

## Canonical implementation inputs

Before implementing or changing a framework integration, use all of the
following repository-owned sources:

1. `/llms.txt`, `/llms-api.txt`, and the page-level Markdown endpoints from the
   Docs application.
2. The read-only `@murasakijs/mcp` tools. Discover feature IDs with
   `list_capabilities`, then use `check_compatibility` for every target OS.
3. `packages/murasaki/capabilities.json`, which remains authoritative when a
   guide and a capability label appear to disagree.
4. The public configuration schema returned by `get_config_schema`.

`doctor` verifies project structure only. A passing doctor result is never
runtime evidence.

## Shared product requirements

- English and Japanese interfaces.
- Keyboard-complete primary flows and WCAG 2.2 AA-level semantics and contrast.
- A distinct icon and design system for each product.
- macOS, Windows, and Linux source compatibility. Platform limitations must be
  visible and must not be simulated.
- SQLite for local application data. Features shared between users use an
  optional PostgreSQL service started with Docker Compose.
- A clearly labelled realistic sample workspace on normal first launch.
- A Settings action that restores the sample workspace.
- `--no-sample-data` starts with an empty workspace.
- No external SaaS account is required for the reference experience.
- Loading, empty, permission-denied, offline, partial-failure, and recovery
  states are part of the product, not test-only screens.
- Destructive operations require confirmation and produce recoverable results
  where the product domain allows it.

Sample records may demonstrate a workflow, but they must be labelled as sample
data. Live status, request logs, synchronization state, test results, and
performance values must come from the operation they describe.

## Product scope

### Papelle

Papelle combines a warm paper-and-ink atmosphere with modern stationery UI.
Its primary experience is an offline-capable personal workspace.

Required verticals:

- Notion-like block editing with keyboard navigation and block reordering.
- Nested pages, page links, backlinks, tags, and full-text search.
- Standard Markdown import and export without locking user content to Papelle.
- Image, PDF, and audio attachments with organization and preview states.
- Structured databases with table, kanban, and calendar views over the same
  records.
- Local persistence and conflict-safe offline edits.
- Optional real-time collaboration through the self-hosted Docker Compose
  service. Two independent clients must be able to demonstrate convergence.

### Oscilla

Oscilla uses a dark instrument-panel surface and high-contrast signal colors.
It must inspect real traffic rather than presenting prewritten request rows.

Required verticals:

- REST, GraphQL, and WebSocket request workspaces.
- OpenAPI and Postman Collection import with validation and actionable errors.
- Development, staging, and production environments with secrets kept outside
  exported collections and protected by the OS credential store when available.
- Chained scenarios, variable extraction, assertions, and repeatable results.
- A local OpenAPI-driven mock server with success, delay, and error behaviors.
- A unified timeline for Oscilla traffic, tailed local files, and Docker logs,
  filterable by level, service, and request ID.
- Explicit process lifecycle, disconnect, retry, truncation, and backpressure
  behavior for every long-running stream.

### Orglia

Orglia is a bright, role-aware operations workspace. Modules have distinct
identification colors but share one relational data model and navigation shell.

Required verticals:

- Sidebar navigation across projects, CRM, approvals, inventory and orders,
  shifts, analytics, incidents, and administration.
- Linked customer → opportunity/project → order → inventory allocation → sales
  reporting flow.
- Configurable request forms, multi-step approval, rejection, return for
  changes, and immutable audit records.
- Shift requests, staffing requirements, constraints, generated proposals,
  administrator edits, and publication.
- Incident severity, ownership, deadlines, timeline, escalation, resolution,
  and post-incident review.
- Role-based access control for administrators, managers, and members. RBAC is
  enforced by the data operation, not only by hidden navigation.
- Tenant isolation in the self-hosted service.
- Configurable dashboard widgets with date, department, and owner filters plus
  CSV and PDF export.

## Verification ladder

Evidence is cumulative. A later level does not erase a failure at an earlier
level.

| Level | Evidence | What it proves |
| --- | --- | --- |
| L0 | MCP compatibility report and documented limitation review | The design uses known feature names and does not treat planned work as shipped |
| L1 | Typecheck, unit tests, and production client build | Source and isolated logic compile |
| L2 | `murasaki dev` with scripted interaction | The renderer, Node runtime, routing, and live data path work together |
| L3 | Restart, empty launch, reset, offline, and recovery tests | State and lifecycle behavior are real |
| L4 | Two-client or external-process integration tests | Collaboration, network protocols, logs, and authorization are real |
| L5 | Bundle launch on the target OS | The packaged application and bundled Node runtime start correctly |
| L6 | Installer install, first launch, update/uninstall checks | Distribution behavior works outside the source tree |
| L7 | Reproducible launch time, idle memory, and artifact-size report | Performance claims have a dated method and comparable evidence |

A reference application is not complete at L1. Any platform that cannot reach a
level must state the exact blocker in its README and in the public feature
status documentation.

## Framework feedback

Reference applications are allowed to reveal missing framework APIs. Do not
hide a gap behind app-specific polling, fixed status rows, browser-only mocks,
or an undocumented native call. Record:

1. the user-visible requirement;
2. the smallest reproduction;
3. the current capability verdict by platform;
4. the proposed public API and permission boundary;
5. the runtime and packaging tests required before the gap is considered fixed.
