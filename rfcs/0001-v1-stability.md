# RFC 0001 — v1.0 Stabilization Plan

- Status: Draft (authored 2026-07-17)
- Owner: framework core
- Scope: `murasaki`, `@murasakijs/native`, `create-murasaki`, `capabilities.json` schema

## 1. Problem

`capabilities.json` v0.53.0 declares **zero** features `stable` (17 `partial`, 7
`experimental`, 1 `planned`). Teams evaluating Murasaki against Electron/Tauri
have no semver-backed surface to build on. v1.0 is the moment we convert the
honesty manifest from "everything is in flux" into a contract.

## 2. Definition of `stable`

A feature may be declared `stable` only when **all** of the following hold:

1. **Frozen surface.** Every exported name, signature, config field, IPC method,
   and wire shape the feature exposes is captured in the API Extractor report
   (`packages/murasaki/api/*.api.md`) or, for native methods, in the
   `permission_for_native_method` table. Breaking any of them thereafter
   requires a major release.
2. **Behavioral test evidence.** Automated tests exercise the documented
   behavior: unit tests in `packages/murasaki/test/` or `crates/native`
   `#[cfg(test)]`, plus — for packaging/update/lifecycle features — the
   packaged E2E workflows (`app-package-mac.yml`, `app-package-win.yml`).
   `testEvidence` in `capabilities.json` must reference them.
3. **Per-platform declaration.** Stability is declared per platform. A feature
   can be `stable` on macOS/Windows while its Linux entry remains
   `development-only`. The `status` field describes the best supported
   platform; per-platform truth lives in `platforms`.
4. **Documentation.** en + ja guide pages exist, 1:1, and the limitations list
   matches the code.
5. **Bake time.** No breaking change to the feature's surface for two
   consecutive minor releases before the release that stamps it `stable`.

### Schema change

`capabilities.json` schemaVersion 2: allow `"stable"` in the feature `status`
enum and in per-platform values. Update
`scripts/validate-capabilities.mjs` accordingly, and extend the validator to
**require** `testEvidence` for every `stable` feature.

## 3. Semver and deprecation policy

- **`murasaki` 1.0.0** — semver from here on. Breaking = major. New surface =
  minor. Fix = patch.
- **`@murasakijs/native`** keeps its own version line; `murasaki` 1.x declares
  a compatibility range (`>=1.0 <2`) and CI enforces publish ordering (already
  in `release.yml`). Native IPC methods and the capability-policy JSON
  (version 1) are part of the frozen surface.
- **`create-murasaki`** tracks `murasaki` minor versions (template pinning is
  already release-synced).
- **Deprecation:** post-1.0, deprecate in a minor (docs + `@deprecated` JSDoc +
  runtime structured warning where feasible), remove only in the next major.
  Pre-1.0 (remaining 0.x releases): one-minor deprecation window is allowed.
- **Experimental surface post-1.0** lives under an explicit namespace: config
  under `experimental: { ... }`, exports prefixed `unstable_`. Moving out of
  the namespace is a minor release; the namespace itself carries no stability
  promise.

## 4. Wire and protocol freezes at 1.0

| Surface | Freeze |
| --- | --- |
| Server-action wire codec | `WIRE_VERSION = 1` frozen: 1.x decoders accept v1 forever; extensions negotiate v2+ with fallback. Payload cap (32 MiB) becomes contractual maximum-minimum (may raise, never lower, in 1.x). |
| Native IPC envelope | `kind` discriminators + `nativeCall` method names frozen; additive methods allowed (deny-by-default keeps them invisible without grants). |
| Capability policy JSON | `version: 1` frozen; v2 additive with fail-closed rejection of unknown versions (already the behavior). |
| Update manifest | Fields as of B1 hardening (incl. `generatedAt`, `keyId`, `rollout`) frozen; unknown fields ignored-but-signed. |
| `.murasaki-apply.json` handoff + update journal | Internal, but version-tagged; launcher must reject unknown journal versions (verify — gap if absent). |
| `capabilities.json` schema | schemaVersion 2 as above. |

## 5. Feature disposition at 1.0

**Stamp `stable` (macOS + Windows), gated on the listed work merging:**

| Feature | Gate |
| --- | --- |
| file-routing | B4 (searchParams/catch-all) + S3 tests |
| route-metadata | B4 title sync + S3 tests |
| navigation-middleware | S3 tests |
| native-window | A2 window features + tests |
| application-menu / context-menu | S3 context-menu tests; menu i18n gaps documented |
| native-utilities | A3 (message dialog, clipboard image/HTML, trash, openPath) |
| capability-permissions | already twice-enforced; needs schemaVersion 2 relabel |
| loopback-endpoint-protection | as-is |
| content-security-policy | as-is (meta-tag limitation documented) |
| application-packaging / code-signing | as-is (macOS/Windows) |
| auto-update | B1 hardening (TLS, freshness, multi-key, rollout, win32-arm64) |
| single-instance-and-deep-links | as-is |
| tray-and-global-shortcuts | as-is (macOS/Windows) |
| secure-storage | promote from experimental — implementation and tests are already the strongest in the tree; keep command-level-grant limitation documented |
| diagnostics-and-logging | A4 phase 1 (crash capture) folds in |

**Hold at `experimental`/`partial` through 1.0 (promote in 1.x minors):**

- **server-actions, api-routes** — wire format young; promote ~1.2 after two
  quiet minors.
- **node-main-lifecycle** — promote once crash-restart policy + health-check
  API land (A4 phase 2).
- **multi-window** — promote at 1.1 once runtime-created windows soak.
- **webview-session-network** — new A1 surface (downloads, cookies, zoom,
  init scripts) enters here; promote after bake time.
- **system-permissions** — Windows story still `partial`.
- **build-time-plugin-sdk** — C1 runtime-plugin RFC may reshape; do not freeze.
- **linux-distribution** — S2 track; target 1.x, never blocks 1.0.

## 6. Release gating checklist for 1.0.0

1. Wave 1 + native track branches merged; full suite green on all CI jobs.
2. `api:check` gating on (already) + API report reviewed once by hand.
3. capabilities.json schemaVersion 2 + validator enforcing testEvidence-for-stable.
4. Docs audit: every stable feature's en/ja pages exist and match behavior.
5. Migration guide 0.x → 1.0 (expected: config renames only, ideally empty).
6. RC period: ≥2 weeks, `1.0.0-rc.N`, three example apps + updater E2E on all
   4 OS/arch CI jobs; no P0/P1 opened against RC in final week.
7. Launch comms reuse the honesty manifest: "stable means tested, frozen,
   per-platform" is the headline differentiator.

## 7. Out of scope for this RFC

- Linux packaging plan → RFC 0002.
- Crash reporting/diagnostics architecture → RFC 0003.
- Runtime plugin system → RFC 0004 (explicitly must not block 1.0).
