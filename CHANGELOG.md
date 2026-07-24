# Changelog

Murasaki follows semantic versioning while it is pre-1.0: minor releases may
contain documented breaking changes. See the matching migration guide before
upgrading production applications.

## 0.55.7 — React Aria UI foundation (2026-07-24)

Murasaki's default UI foundation now uses React Aria Components throughout.
The public `@murasakijs/ui` component names and familiar value-based props stay
available, while focus management, keyboard interaction, selection, and
overlay behavior no longer depend on Radix UI or `cmdk`.

### Added

- **React Aria component foundation.** `@murasakijs/ui` 0.3.0 removes every
  direct Radix UI and `cmdk` dependency. Interactive controls and overlays use
  React Aria Components; primitives without a direct React Aria equivalent use
  small accessible Murasaki adapters rather than carrying Radix internally.
- **Framework and scaffold integration.** `murasaki`'s ready-made
  `UpdateButton` and newly generated applications consume the React Aria-based
  UI package by default.
- **Live component documentation.** Every component detail page now includes
  an interactive playground. The updater guide includes a stateful playground
  covering unavailable, available, downloading, ready, and error states.
- **AI-facing documentation.** The generated MCP documentation corpus and
  framework guidance now identify React Aria as the current UI foundation.

### Notes

- Existing imports from `@murasakijs/ui` should continue to work. Applications
  that targeted undocumented Radix DOM structure, Radix-specific data
  attributes, or `cmdk` internals must move those styles and selectors to the
  documented Murasaki component API.
- `asChild` remains available through Murasaki's local compatibility slot; it
  no longer installs `@radix-ui/react-slot`.
- The documentation application now uses Next.js 16.2.11, shadcn 4.14.1, and
  patched `sharp`/`fast-uri` resolutions. The release security gate reports no
  high or critical npm advisories.

## 0.55.6 — the stability declaration (2026-07-20)

Every one of the 26 features in the capability manifest is now `status: stable`
— a compatibility commitment for the current release line backed by cited test
evidence, not a label change. Platform labels stay honest where an OS-level gap
is real.

### Added

- **Configurable About panels.** An `about` config opts into a native About
  panel with custom body paragraphs, label/value detail rows (Build, Commit, …),
  external-link buttons, and size control on macOS, Windows, and Linux. When
  omitted, each platform keeps its compact standard About dialog.
- **CSP delivered as a response header.** The resolved Content Security Policy
  now ships as an HTTP `Content-Security-Policy` response header (dev middleware
  and the packaged production server) in addition to the meta tag, from a single
  resolver — so header-only directives such as the new default
  `frame-ancestors 'none'` are actually enforced. A user-owned CSP meta tag in
  `index.html` stays authoritative: Murasaki then sends no header and defers
  entirely to the tag, re-checking the live file per request in dev.

### Fixed

- **Linux cookie deletion.** On WebKitGTK, `webview.deleteCookie()` resolved
  but the cookie was never removed: WebKit matches the cookie to delete by full
  equality including its value, which the caller doesn't have. A vendored wry
  patch looks the stored cookie up by name, domain, and path — like macOS and
  Windows — so deletion now reflects on the next read (`@murasakijs/native`
  0.43.2, verified in a packaged AppImage).
- Orglia sample form styling polish.

### Notes

- `webview-session-network` is now `supported` on Linux. The remaining honest
  platform gaps: system permissions stay `unsupported` on Linux and `partial`
  on Windows (no OS equivalent of macOS TCC prompts), and the Linux tray still
  needs an AppIndicator host with global shortcuts requiring X11/XWayland.

## 0.55.5 — Linux feature parity (2026-07-20)

Linux moves onto the same footing as macOS and Windows for every feature that
is not blocked by an OS-level gap. 16 of 26 capabilities are now `supported` on
Linux (up from 2), each verified end to end in a packaged AppImage.

### Added

- **Linux feature parity.** File routing, navigation middleware, route metadata,
  server actions, API routes, the Node Main lifecycle, content security policy,
  capability permissions, diagnostics/crash reports, the build-time plugin SDK,
  native windows, and declarative multi-window are now `supported` on Linux,
  proven by a packaged-AppImage feature probe running under Xvfb in CI.
- **Linux code signing.** `murasaki installer --sign` produces detached, armored
  GPG signatures for the `.AppImage`, the `.deb`, and a combined `SHA256SUMS`
  (and opportunistically embeds a Debian-native signature via `dpkg-sig`). The
  key is selected with `$MURASAKI_GPG_KEY` or `sign.linux.gpgKey`; the passphrase
  comes only from `$MURASAKI_GPG_PASSPHRASE` or the gpg-agent.
- `murasaki demo` gained one-command launch of the Papelle, Oscilla, and Orglia
  sample previews.

### Fixed

- **macOS About-panel icon rendering.** The standard About panel now inherits
  the LaunchServices-resolved application icon instead of receiving the raw
  source PNG. Its mask, corner radius, shadow, and appearance therefore match
  the icon shown by Finder and the Dock.
- **Linux multi-window recreate crash.** Destroying and recreating a secondary
  window at runtime aborted the packaged process with an X11 `BadWindow` error.
  Two stacked causes are fixed: per-window `WebContext`s are now released on
  destroy so a recreate builds a fresh one, and a vendored one-line wry patch
  (`crates/native/vendor/wry`) stops `Drop for X11Data` from destroying the
  parent window's X resource in the non-child embedding path.
- Windows now retries an OS-excluded (`EACCES`) deterministic origin port during
  a first-launch bind instead of failing to start.

### Notes

- Linux remains `partial` where an OS gap is real: secure storage needs a Secret
  Service provider; `.deb` updates are package-manager-owned; there is no rpm or
  distribution-repository trust integration; tray needs an AppIndicator host and
  global shortcuts require X11/XWayland; `webview.deleteCookie()` is not reliably
  reflected on WebKitGTK. System permissions stay `unsupported` on Linux — there
  is no OS-level equivalent of macOS TCC prompts.
- No feature is `planned` on any platform anymore.

## 0.55.4 — zero-dependency scaffolder (2026-07-20)

- Removes the scaffolder's runtime dependency tree in favor of Node's built-in prompt and spinner
  primitives, preventing package-store link failures before the CLI can start.
- Guarantees the unattended `--yes --skip-install` path runs directly from the packed tarball with
  no installed dependencies.

## 0.55.3 — reusable dependency verification (2026-07-20)

- Lets the release gate reuse an already-published workspace package only when its published git
  commit is an ancestor and the package directory is unchanged through the current release.
- Keeps strict integrity, provenance, and current-commit checks for packages published by the tag.

## 0.55.2 — reliable fresh scaffolds (2026-07-20)

- Makes the default Biome setup use its installed schema and the current recommended-rule preset.
- Pins the scaffolded Biome CLI so a newly generated app remains lint-clean over time.
- Verifies a fresh packed scaffold with lint, type-check, and production build in CI.

## 0.55.1 — release verification hardening (2026-07-20)

- Makes npm payload inspection work from the pnpm workspace root.
- Waits for npm registry propagation between dependency-ordered publishes.
- Runs final integrity, git-head, and SLSA provenance verification correctly on Node.js 24.

## 0.55.0 — production-candidate foundations (2026-07-20)

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

## 0.54.0 — first public release (2026-07-18)

The first npm release of the framework: file routing, Server Actions, API
routes, and typed `'use main'` calls on React 19 + Vite; native window, menu,
tray, global shortcut, dialog, clipboard, notification, and WebView APIs behind
default-deny capability policies; macOS system-permission (TCC) requests and
Windows elevation; `.dmg`, NSIS, and MSI packaging with Ed25519-signed
automatic updates; and the Papelle, Oscilla, and Orglia sample applications.
