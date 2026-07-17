# RFC 0003 — Crash Reporting & Diagnostics

- Status: Draft (authored 2026-07-17); Phase 1 implementation authorized
- Crash domains: (1) Node Main / prod-server, (2) native launcher + binding,
  (3) renderer (WebView) in production

## Phase 1 — framework-owned capture (no vendor lock-in)

**Storage.** `<appData>/<appId>/crash-reports/<ISO-ts>-<domain>.json`,
rotation keeps the newest 20. Report shape (versioned `reportVersion: 1`):
`{ reportVersion, domain: 'node'|'native'|'renderer', timestamp, appVersion,
frameworkVersion, os, arch, message, stack?, extra? }`. Secret-field redaction
reuses the logger's redaction pass.

1. **Node domain.** `uncaughtException` / `unhandledRejection` hooks in the
   main runtime write a report (bounded, synchronous-safe) before the existing
   fail-fast path runs. Config: `diagnostics: { crashReports?: boolean
   (default true), keepReports?: number (default 20, 1..100) }`.
2. **Native domain.** Rust `std::panic::set_hook` in the launcher writes a
   `native` report (panic payload + thread + location; no unwinding
   suppression — abort semantics unchanged). The existing unexpected-Node-exit
   detection additionally writes a report with exit code/signal and the last
   64 redacted log lines.
3. **Renderer domain (prod).** `window.onerror` + `unhandledrejection` in the
   production client bootstrap POST a bounded payload (≤16 KiB, ≤10/min
   rate-limited client-side) to a new authenticated loopback endpoint
   `/__murasaki/diagnostics/renderer-error` (session-cookie tier, same checks
   as other privileged paths; drops silently in dev where the overlay owns UX).
4. **Read API (Node Main).** `ctx.diagnostics.listCrashReports()` /
   `readCrashReport(id)` / `clearCrashReports()` — enables "send on next
   launch" flows in app code without murasaki phoning anywhere. Murasaki
   itself never transmits.

## Phase 2 — vendor integration (docs + example, later)

Official guide wiring `@sentry/node` (Node Main via `ready()`),
`@sentry/react` (renderer), and a `main.ts` snippet that drains
`listCrashReports()` into any vendor on launch. Native minidumps
(`minidumper`/`crash-handler`) deferred until demand — panic-hook JSON covers
the Rust-side gap meaningfully first.

## Non-goals

No auto-upload, no telemetry, no crash UI. The framework captures and exposes;
the app decides transmission (aligns with the deny-by-default posture).
