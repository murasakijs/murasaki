# Oscilla

Oscilla is a dark, signal-driven API development workbench built as a standalone Murasaki example.
It is a real Node Main vertical slice: requests execute outside the renderer, the complete workspace
is stored in SQLite, a loopback OpenAPI mock emits real traffic, and app/Docker/local-file events
converge into a bounded live timeline.

## Requirement matrix

| Requirement | Status | Implementation / verification |
| --- | --- | --- |
| Dark instrument UI + protocol signal colors | Implemented | Dense oscilloscope-inspired request, response, scenario, and timeline surfaces; REST cyan, GraphQL violet, WebSocket amber |
| REST execution | Implemented | Typed `'use main'` call performs a real Node `fetch`; request bodies and streamed responses are bounded at 2 MiB |
| GraphQL execution | Implemented | Real POST execution with JSON GraphQL payloads through Node Main |
| WebSocket | Implemented | Opens a real socket, sends one message, captures one bounded response, and forcibly terminates the one-shot connection on success, timeout, or error; request and bearer headers are supported |
| OpenAPI import | Implemented | OpenAPI JSON imports every supported operation and persists the source document |
| Postman import | Implemented | Nested Postman collection v2 JSON imports every request plus collection variables |
| Persisted workspace | Implemented | A versioned SQLite workspace record persists requests, collections, environments, variables, scenarios, imported documents, and mock configuration |
| Navigation and request collections | Implemented | Every navigation item opens a working surface; Collections exposes every imported request and selects it into the editor |
| dev / staging / prod environments | Implemented | Persisted editable environment base URLs and active-environment variable resolution |
| Safe credential storage | Implemented | `murasaki/native.secureStorage`; no plaintext or SQLite fallback |
| Scenario authoring + assertions | Implemented | Persisted scenario/step editing, request selection, status assertions, JSON-path extraction, stop-on-failure, and explicit save |
| Extracted variables consumed | Implemented | The sample extracts `$.id` into `telemetryId`; the next URL consumes `{{telemetryId}}` and is verified in the real timeline |
| OpenAPI mock server | Implemented | Persisted imported examples/schemas drive an app-owned loopback server with normal, 1.2-second delay, and forced-503 modes |
| Unified app / local / Docker timeline | Implemented | Real request/mock events, browser-selected bounded local-log snapshots, and optional `docker logs --follow` |
| Log lifecycle hardening | Implemented | Explicit detach/cleanup, partial-line buffering, bounded queues with drop reporting, stream pause/resume, and 16 KiB line retention |
| Timeline/database retention | Implemented | SQLite retains the latest 5,000 events; RPC snapshots are capped at 500 and the visible table at 80 |
| Level / service / request ID filtering | Implemented | Filters operate on real retained events, not fixed arrays |
| Runtime health | Implemented | LIVE/OFFLINE, SQLite, mock, Docker, and local-log states derive from runtime state and are pushed through Main events |
| Japanese / English | Implemented | In-app switch covers core product chrome, authoring controls, statuses, and accessibility names; user data and raw log content are intentionally not translated |
| macOS / Windows / Linux | Partial | All targets are declared. Murasaki can assemble Linux AppDir/AppImage/deb artifacts, but Oscilla's Node Main/native integrations have not been validated on every Linux distribution |
| SQLite persistence | Implemented | Node `node:sqlite`, WAL mode, and data under Murasaki `paths.data` |
| Node 22 runtime safety | Implemented | Package engines and startup gate require Node `^22.13.0 || >=24`; Node 22.12 fails fast because `node:sqlite` was still flagged there |
| Accessibility / WCAG 2.2 AA | Partial | Keyboard controls, semantic/labelled tabs, non-color status text, visible focus, and contrast-adjusted tokens are implemented; no full automated/manual WCAG conformance audit is claimed |
| Distinct app icon | Implemented | Project-local Oscilla oscilloscope icon configured for dev/bundle generation |
| Explicit sample data | Implemented | Labeled sample request, collection, and chained scenario |
| Reset | Implemented | Confirmation resets the persisted workspace, timeline, scenarios, imports, variables, and mock mode |
| `--no-sample-data` | Implemented | Initializes an empty durable workspace while retaining the three environment definitions |

## Runtime baseline

Oscilla intentionally does **not** claim the repository's Node 22.12 floor. `node:sqlite` became
available without the experimental flag in Node 22.13, so both `package.json` and Node Main enforce:

```text
^22.13.0 || >=24.0.0
```

This is a visible startup requirement, not an implicit dependency. Supporting Node 22.12 safely
would require adding and locking a cross-platform SQLite dependency, which is outside this example's
no-root-lockfile scope.

## Murasaki capability grounding

This example was checked against `packages/mcp/content/capabilities.json`, the generated LLM API
surface in `apps/docs/lib/llms.ts`, and the checked-in Node Main/native documentation:

- Node Main lifecycle and typed `'use main'` calls are experimental.
- Main events are authenticated and live-only; Oscilla uses SQLite snapshots for replay.
- Secure storage is experimental and backed by Keychain, Credential Manager, or Linux Secret
  Service, with no plaintext fallback.
- Linux packaging assembly exists for AppDir, AppImage, and deb. Cross-distribution behavior of this
  Node Main application remains only partially validated.

## Run

```bash
pnpm --dir examples/oscilla dev
pnpm --dir examples/oscilla dev -- --no-sample-data
```

The mock binds only to `127.0.0.1`. Imports are capped at 2 MiB and the serialized durable workspace
at 4 MiB. Local logs use a browser file input: the renderer sends only the selected file's basename
and at most 1 MiB of text to Node Main, never an arbitrary filesystem path. The timeline retains only
the final bounded 64 KiB snapshot.

## Verify

```bash
pnpm --dir examples/oscilla typecheck
pnpm --dir examples/oscilla test
pnpm --dir examples/oscilla build
pnpm --dir examples/oscilla bundle
pnpm --dir examples/oscilla installer
```

The test suite covers imports, interpolation/assertions, runtime-version enforcement, empty/sample
workspace construction, full import persistence, malformed persisted state, partial log lines,
queue retention/drop accounting, streamed HTTP response bounds, and forced WebSocket timeout
termination against a non-cooperating peer.
