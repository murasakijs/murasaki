# Linux parity probe

A dedicated verification app — not a product — that exercises the Murasaki
capabilities currently labeled `development-only` (or, for `multi-window`,
`unsupported`) on Linux in `packages/murasaki/capabilities.json`, so that
label can be promoted from actual evidence rather than assumption.

Every check runs inside a real packaged Linux AppImage (built with
`murasaki bundle --target linux-x64|linux-arm64`) and is asserted from
*outside* the WebView — CI has no display — through:

- the loopback HTTP server (`curl /api/*`, `curl /`),
- files on disk (crash reports, JSONL logs, the build-time plugin sentinel),
- and greppable `PROBE:<feature>:PASS` stdout markers printed by a renderer
  self-test that runs on page load (see `src/app/layout.tsx` and
  `src/lib/probeOrchestrator.ts`).

See `.github/scripts/linux-feature-probe.sh` for the assertions and
`.github/workflows/app-package-linux.yml` for how this app is built, bundled,
and exercised in CI (and reproduced locally in Docker).

`src/api/probe/crash-node/route.ts` intentionally crashes this app's own Node
Main process on demand, to verify diagnostics-and-logging's crash-report
capture. `.github/scripts/linux-feature-probe.sh` triggers it from a second,
dedicated app launch rather than chaining it after the renderer's own
multi-window check — see that route's and that script's comments for why.
