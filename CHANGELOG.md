# Changelog

Murasaki follows semantic versioning while it is pre-1.0: minor releases may
contain documented breaking changes. See the matching migration guide before
upgrading production applications.

## 0.55.3 — reusable dependency verification

- Lets the release gate reuse an already-published workspace package only when its published git
  commit is an ancestor and the package directory is unchanged through the current release.
- Keeps strict integrity, provenance, and current-commit checks for packages published by the tag.

## 0.55.2 — reliable fresh scaffolds

- Makes the default Biome setup use its installed schema and the current recommended-rule preset.
- Pins the scaffolded Biome CLI so a newly generated app remains lint-clean over time.
- Verifies a fresh packed scaffold with lint, type-check, and production build in CI.

## 0.55.1 — release verification hardening

- Makes npm payload inspection work from the pnpm workspace root.
- Waits for npm registry propagation between dependency-ordered publishes.
- Runs final integrity, git-head, and SLSA provenance verification correctly on Node.js 24.

## 0.55.0 — production-candidate foundations

### Added

- A long-lived Node Main runtime with typed `'use main'` calls, lifecycle
  hooks, sidecar supervision, crash reports, and declarative multi-window
  control.
- Stable per-app browser origins and isolated per-window browser profiles.
- Native tray, global shortcut, autostart, secure storage, notification,
  dialogs, clipboard, file/system shell, WebView, permission, and updater APIs
  behind default-deny capability policies.
- macOS arm64/x64, Windows arm64/x64, and Linux arm64/x64 packaging paths,
  including DMG, NSIS, MSI, AppImage, and deb generation where the documented
  host tools are available.
- Signed update manifests with key rotation, staged rollout, persistent replay
  protection, rollback journals, and health acknowledgement.
- `MURASAKI_PUBLIC_*` renderer environment variables, `llms.txt` endpoints, a
  read-only MCP documentation server, and an expanded UI component library.
- Three independent application examples: Papelle, Oscilla, and Orglia.

### Security

- Renderer/native and renderer/backend authority are separate and deny all by
  default. Packaged window credentials are origin-, label-, and
  generation-bound and are revoked with the native window lifecycle.
- Production and development responses deny camera, microphone, and
  geolocation Web APIs by default through `Permissions-Policy`.
- Bundled Node downloads verify Node's OpenPGP-signed checksum document before
  trusting an archive checksum.
- Updater manifests require `generatedAt` by default and reject replayed or
  lower-version authenticated manifests across restarts.
- App-owned executable resources participate in the platform's inner-to-outer
  signing pass.

### Breaking changes from 0.54

- Use `MURASAKI_PUBLIC_*` for renderer-visible environment values. Private
  values stay in Node/config only; additional prefixes require an explicit
  `build.envPrefix` entry.
- Update manifests without `generatedAt` are rejected unless the temporary
  `allowLegacyManifestsWithoutGeneratedAt` migration flag is enabled.
- Executable bundle resources must use
  `{ from, to, executable: true }`; undeclared Mach-O, PE, ELF, or shebang
  resources fail packaging.
- A persisted application-origin port no longer silently falls back when it is
  occupied. Startup fails instead, preserving existing Web Storage and
  IndexedDB identity.
- macOS App Sandbox configuration is rejected until the bundled Node helper has
  a valid sandbox architecture. Hardened Runtime signing remains supported.
- Node.js 22.12.0 is the minimum supported development runtime.

Full migration steps: [English](https://murasaki.ichi10.com/docs/building/migration-0.55) ·
[日本語](https://murasaki.ichi10.com/ja/docs/building/migration-0.55)
