<div align="center">

<img src="https://raw.githubusercontent.com/murasakijs/murasaki/main/assets/logo.svg" alt="Murasaki — the desktop framework for Next.js developers" width="720">

**The desktop framework for Next.js developers.**

React 19 · Vite · OS WebView · Rust-native · No Chromium

[![npm version](https://img.shields.io/npm/v/murasaki?color=A855F7&label=npm)](https://www.npmjs.com/package/murasaki)
[![npm downloads](https://img.shields.io/npm/dm/murasaki?color=A855F7)](https://www.npmjs.com/package/murasaki)
[![license](https://img.shields.io/npm/l/murasaki?color=A855F7)](https://github.com/murasakijs/murasaki/blob/main/LICENSE)
[![CI](https://github.com/murasakijs/murasaki/actions/workflows/ci.yml/badge.svg)](https://github.com/murasakijs/murasaki/actions/workflows/ci.yml)

[English](https://github.com/murasakijs/murasaki/blob/main/README.md) · [日本語](https://github.com/murasakijs/murasaki/blob/main/README.ja.md)

</div>

---

Murasaki is a TypeScript-first desktop framework with a **Next.js-inspired DX**:
file-based project layout, layouts, metadata, and React 19 server actions,
built on **React 19 + Vite**, rendered through the **OS WebView already
installed on your machine** — no bundled Chromium. The native window, menus,
and OS integrations are powered by a self-authored Rust binding,
[`@murasakijs/native`](https://www.npmjs.com/package/@murasakijs/native) —
you write TypeScript; you never write Rust. Production targets **macOS and
Windows**; Linux currently has a development runtime but no packaging claim.

```bash
npm create murasaki@latest my-app
cd my-app
npm run dev
```

```tsx
// src/app/page.tsx
import { useState } from 'react'
import { useContextMenu, Action } from 'murasaki'

export default function Page() {
  const [count, setCount] = useState(0)

  // The window-wide menu — declared as data, right next to your state.
  useContextMenu([
    { label: 'Increment', shortcut: 'command,I', action: () => setCount((n) => n + 1) },
    { separator: true },
    { label: 'Reload', shortcut: 'command,R', action: () => location.reload() },
    { label: 'Copy', action: <Action.Copy /> },
  ])

  return (
    <main>
      <h1>Hello, Murasaki 🦋</h1>
      <button onClick={() => setCount((n) => n + 1)}>Clicked {count} times</button>
    </main>
  )
}
```

Grant that renderer `menu:context` and `clipboard:writeText` in
`murasaki.config.ts`; native menu roles are denied unless their matching
capability is present.

That's a real Vite dev server with React Fast Refresh, rendered in a native
window — and right-clicking anywhere shows a **real OS context menu** (NSMenu
on macOS and HMENU on Windows), not an HTML popup.

---

## Table of Contents

- [Quick start](#quick-start)
- [Example apps](#example-apps)
- [Why murasaki?](#why-murasaki)
- [Features](#features)
- [CLI reference](#cli-reference)
- [Signing & distribution](#signing--distribution)
- [Configuration (`murasaki.config.ts`)](#configuration-murasakiconfigts)
- [Server Actions](#server-actions)
- [API Routes](#api-routes)
- [Architecture](#architecture)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Code of Conduct](#code-of-conduct)
- [Security](#security)
- [License](#license)

---

## Quick start

```bash
# scaffold
npm create murasaki@latest my-app

# develop with Vite HMR + React Fast Refresh
cd my-app
npm run dev

# ship (macOS and Windows today — see CLI reference)
npm run build       # dist/client   Vite production build
npm run bundle      # portable native app bundle for the selected target
npm run installer   # .dmg on macOS; optional .exe / .msi on Windows targets
```

The scaffold gives you a React 19 + Vite + Tailwind app with a Next.js-like
layout — you only touch `src/app/` (pages, layouts, `globals.css`), `src/api/`
(API routes), and `src/middleware.ts`. There's no `index.html` or entry
file to maintain: murasaki owns the app shell and the client bootstrap (drop
your own `index.html` in the project root if you want to customize the HTML
head). `murasaki.config.ts` describes your app's identity and window.

---

## Example apps

Three independent apps show different product directions. Each has its own
source tree, app identity, icon, native bundle, and installer.

| App | What it demonstrates | Source |
| --- | --- | --- |
| **Violet Notes** | Local-first Markdown editing, live preview, import/export, native menus | [`examples/violet-notes`](https://github.com/murasakijs/murasaki/tree/main/examples/violet-notes) |
| **Murasaki Focus** | Persistent timer state, keyboard controls, consumer desktop UI | [`examples/murasaki-focus`](https://github.com/murasakijs/murasaki/tree/main/examples/murasaki-focus) |
| **Local Signal** | API Routes, Server Actions, bundled Node runtime, request monitoring | [`examples/local-signal`](https://github.com/murasakijs/murasaki/tree/main/examples/local-signal) |

<p align="center">
  <img src="https://raw.githubusercontent.com/murasakijs/murasaki/main/examples/violet-notes/design/implementation.png" alt="Violet Notes" width="31%">
  <img src="https://raw.githubusercontent.com/murasakijs/murasaki/main/examples/murasaki-focus/design/implementation.png" alt="Murasaki Focus" width="31%">
  <img src="https://raw.githubusercontent.com/murasakijs/murasaki/main/examples/local-signal/design/implementation.png" alt="Local Signal" width="31%">
</p>

On macOS, run the checksum-verified developer previews from the CLI. It selects
the correct Apple silicon or Intel build, verifies the published SHA256 and
ad-hoc code signature, then explicitly removes quarantine before launch:

```bash
pnpm dlx murasaki@latest demo violet-notes
pnpm dlx murasaki@latest demo murasaki-focus
pnpm dlx murasaki@latest demo local-signal
```

These are developer previews, not notarized consumer downloads. The immutable
build artifacts remain available in the
[sample-apps v0.47.2 release](https://github.com/murasakijs/murasaki/releases/tag/samples-v0.47.2).

---

## Why murasaki?

The size/memory story is about what each framework bundles, not a number
we've benchmarked head-to-head:

- **Electron** bundles a full Chromium **and** Node into every app.
- **Tauri** renders through the OS WebView (no Chromium) and bundles no
  runtime at all — smallest footprint, but your backend is Rust.
- **murasaki** also renders through the OS WebView (no Chromium), but bundles
  Node so your whole app — client and server-side logic — stays TypeScript.

|                  | **murasaki**                    | Electron                | Tauri                  |
| ---------------- | -------------------------------- | ------------------------ | ------------------------ |
| Rendering        | OS WebView (WKWebView / WebView2 / WebKitGTK) | Bundled Chromium | OS WebView |
| Runtime bundled  | Node.js                          | Chromium + Node          | none                     |
| Backend language | TypeScript                       | TypeScript                | Rust                     |
| You write Rust?  | No (prebuilt native binding)     | No                        | Yes                      |
| Installer size   | **~43 MB `.dmg`** / **~120 MB `.app`** (measured, macOS) | ~80–150 MB\* | ~3–10 MB\* |
| npm ecosystem    | full                              | full                      | client only              |
| Server actions   | `defineAction` / `useAction`     | manual IPC                | manual IPC / commands    |
| Auto-publish CI  | Trusted Publisher OIDC           | manual                    | manual                   |

<sub>\* commonly cited ballparks for Electron/Tauri installers — not measured by us. murasaki's numbers are our own, real `.dmg`/`.app` sizes on macOS.</sub>

### Choose murasaki if...

- You already write **Next.js / React** and don't want to learn Rust.
- You want a **native OS context menu, menus, dialogs, notifications** —
  without writing platform code.
- You're fine with Node being bundled in exchange for **zero Rust**.

### Choose Tauri if...

- You need the smallest possible installer and are willing to write your
  backend in **Rust**.

### Choose Electron if...

- You need a **guaranteed Chromium** environment (specific web APIs, the
  DevTools protocol) regardless of install size.

---

## Features

- **Vite dev server + React Fast Refresh.** `murasaki dev` boots Vite and
  attaches a native window pointed at it — edit and save, the window updates.
- **File-based routing.** Every `src/app/**/page.tsx` becomes a route
  automatically — nested layouts, dynamic `:param` segments, `loading` /
  `error` / `not-found` boundaries, and client-side `<Link>` navigation, with
  no router config to write.
- **Metadata & middleware.** `export const metadata` / `generateMetadata()` on
  a page or layout set the document title and meta tags; `src/middleware.ts`
  runs before every navigation and can redirect (a route guard) — both
  Next.js-shaped.
- **Native context menu.** Declare it with a hook — `useContextMenu([{ label,
  action, shortcut }])` — data next to your state; `action` is a built-in
  `<Action.* />` element or your own function. No id is the
  whole-window menu; give it an id and tag a region with `<ContextMenuTrigger
  id>` to scope it. It posts to the Rust side, which pops a real OS menu (NSMenu
  / HMENU). No HTML popup involved.
- **Native menus, dialogs, clipboard, notifications, shell.** Built on
  [`@murasakijs/native`](https://www.npmjs.com/package/@murasakijs/native):
  open/save/directory dialogs, clipboard read/write, OS notifications, and
  "reveal in Finder/Explorer" — all typed, no Rust required to call them.
- **macOS menu-bar status items / Windows system tray.** One process-wide
  icon with native nested menus, click/menu events, tooltips, and dynamic
  icon/menu replacement, protected by per-renderer capabilities.
- **macOS system permissions.** Declare camera/microphone purpose strings and
  optional launch prompts in config; query/request camera, microphone, screen
  recording, and accessibility consent from trusted renderer code.
- **Server Actions, running end-to-end.** `defineAction` + `useAction` mirror
  React 19's `useActionState` shape, and the `'use server'` function actually
  runs in Node — via a Vite middleware in dev, via a bundled Node child server
  in prod (see [Server Actions](#server-actions)).
- **Theming.** `ThemeProvider` / `useTheme` with light / dark / system modes.
- **Dev error overlay.** Uncaught runtime errors — render errors, unhandled
  promise rejections — surface as a full-screen, murasaki-branded overlay with
  the stack and the React component stack; dismiss with `Esc` or reload. It's
  a no-op in production builds. Since `murasaki dev` serves over
  `http://localhost`, the standard **React DevTools browser extension** also
  works — just open the same URL in Chrome.
- **Packaging.** `murasaki bundle` → a `.app` on macOS, a portable folder /
  `.zip` on Windows. `murasaki installer` → a `.dmg` on macOS, an NSIS `.exe`
  (and an `.msi`, where WiX is available) on Windows. The macOS `.dmg` is
  ~43 MB compressed; the `.app` itself is ~120 MB because it bundles Node and
  your app. See [Platform support](#platform-support) for what's covered.
- **Automatic updates.** Set `updater: true`, drop a `<UpdateButton />` (or the
  `useUpdate()` hook) in your UI, and publish with
  `murasaki release --manifest --sign`. The app fetches the manifest, verifies
  it against your **Ed25519** public key, checks the downloaded asset's
  **SHA-256**, then replaces itself and relaunches. The primary update UI gets
  the internal `app:quit` grant required for that restart; a secondary update
  window must opt in explicitly. macOS and Windows x64 —
  see [Automatic updates](https://murasaki.ichi10.com/en/docs/guides/auto-update).
- **Deep links and file associations.** Declare custom URL schemes and document
  extensions in `murasaki.config.ts`; packaged macOS apps and Windows NSIS/MSI
  installers register them with the OS. Cold starts and running-app opens reach
  one typed Node Main `openRequested()` hook. See
  [Deep links and file associations](https://murasaki.ichi10.com/en/docs/guides/deep-links).
- **Trusted Publisher OIDC.** Tag-push triggers a signed
  `npm publish --provenance` — no long-lived npm tokens in CI.

---

## CLI reference

```
murasaki dev         Start the Vite dev server + native window (HMR, Fast Refresh)
murasaki build       Production Vite build → dist/client
murasaki bundle      Native app folder / .app for the current platform
murasaki installer   Distributable installer for the current platform
murasaki init        Install the Rust toolchain (only if you're hacking on @murasakijs/native)
murasaki icon        Generate .icns / .ico / .png from a single PNG
murasaki release     Auto-update manifest helpers
murasaki help        Show this help
```

### Platform support

|                            | `dev` | `bundle`           | `installer`                       | auto-update |
| -------------------------- | :---: | ------------------ | --------------------------------- | :---------: |
| **macOS** (arm64, x64)     |  ✅   | `.app`             | `.dmg` — must be built on macOS   |     ✅      |
| **Windows** (x64)          |  ✅   | folder / `.zip`    | NSIS `.exe`¹, `.msi`²             |     ✅      |
| **Windows** (arm64)        |  ✅   | folder / `.zip`    | NSIS `.exe`¹                      |     ❌³     |
| **Linux** (x64, arm64)     |  ✅   | —                  | —                                 |     ❌      |

<sub>¹ needs `makensis` on the build machine — it cross-compiles from macOS/Linux.
² needs WiX v4, and must be built on Windows.
³ the Windows installer's filename doesn't encode the architecture yet, so the
update manifest can't tell an arm64 build from an x64 one — tracked as a
follow-up.</sub>

[`@murasakijs/native`](https://www.npmjs.com/package/@murasakijs/native) ships
prebuilt binaries for all six targets, so none of this asks you to install a
Rust toolchain.

**Known limitations, stated plainly:**

- **Linux app packaging isn't implemented.** `murasaki dev` works on Linux, but
  there's no `bundle` or `installer` for it yet.
- **Windows Authenticode needs your own certificate or signing provider.**
  `--sign` wires SignTool across the app executable, portable ZIP payload,
  NSIS setup, and MSI, but Murasaki cannot establish publisher reputation for
  you. A new publisher may still see SmartScreen prompts while reputation grows.
- **macOS signing and notarization need your own paid Apple Developer ID** — see
  [Signing & distribution](#signing--distribution). Unsigned is the default.
- **`mandatory` in the update manifest is advisory.** murasaki hands the flag to
  your app; it does not force the update on the user's behalf.

---

## Signing & distribution

By default, `murasaki bundle`/`murasaki installer` produce an **unsigned**
(ad-hoc) `.app`/`.dmg`. macOS may block copies downloaded through a browser.
Recipients must explicitly allow the app under System Settings → Privacy &
Security, or run `xattr -dr com.apple.quarantine "<path>"` after verifying the
source. Ad-hoc signing alone does not satisfy Gatekeeper distribution policy.

For warning-free distribution, sign and notarize with your own Apple
Developer ID — murasaki ships no certificate of its own:

```
murasaki bundle --sign                 # Developer ID-sign the .app
murasaki installer --sign --notarize   # + submit the .dmg to Apple, staple the ticket
```

On Windows, the same flag Authenticode-signs and verifies every app-owned
artifact with a PFX/store certificate or Microsoft Artifact Signing provider:

```powershell
pnpm exec murasaki installer --target win32-x64 --sign
```

See [Distribution](https://murasaki.ichi10.com/docs/building/distribution) for
certificate selectors, environment variables, timestamping, and CI examples.

The signing identity resolves from `$MURASAKI_SIGN_IDENTITY`, then
`config.sign.identity`, then the first "Developer ID Application" identity in
your keychain. `--notarize` requires `--sign` and reads your notarization
credentials from `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_PASSWORD`
(an app-specific password) — never from config or a file. Both require a paid
Apple Developer Program membership.

### Signed releases with GitHub Actions

Build + (optionally) sign + notarize a `.dmg` on tag push and attach it to a
GitHub Release. Add this as `.github/workflows/release.yml` in your app:

```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: macos-14
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: pnpm install
      - name: Import signing certificate
        if: ${{ secrets.APPLE_CERTIFICATE_P12 != '' }}
        env:
          CERT_P12: ${{ secrets.APPLE_CERTIFICATE_P12 }}
          CERT_PW: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
        run: |
          KC="$RUNNER_TEMP/app.keychain-db"
          security create-keychain -p "" "$KC"
          security set-keychain-settings -lut 21600 "$KC"
          security unlock-keychain -p "" "$KC"
          echo "$CERT_P12" | base64 --decode > "$RUNNER_TEMP/cert.p12"
          security import "$RUNNER_TEMP/cert.p12" -k "$KC" -P "$CERT_PW" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KC"
          security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')
      - name: Build installer
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_APP_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
          HAS_CERT: ${{ secrets.APPLE_CERTIFICATE_P12 != '' }}
        run: |
          if [ "$HAS_CERT" = "true" ]; then
            pnpm exec murasaki installer --sign --notarize
          else
            pnpm exec murasaki installer
          fi
      - uses: softprops/action-gh-release@v2
        with:
          files: dist/*.dmg
```

Add these repository secrets to sign + notarize (omit them all for an unsigned
`.dmg`): `APPLE_CERTIFICATE_P12` (base64 of your Developer ID `.p12`),
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`.

---

## Configuration (`murasaki.config.ts`)

```ts
import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'app.murasaki.example',
  productName: 'Murasaki App',
  version: '0.1.0',
  icon: 'assets/icon.png',
  window: {
    title: 'Murasaki App',
    width: 1000,
    height: 700,
  },
  protocols: [{ scheme: 'murasaki-app' }],
  fileAssociations: [{ extensions: ['murasaki'], role: 'editor' }],
})
```

`MurasakiConfig` also accepts an optional `devPort` (Vite dev server port,
default `5178`), `targets` (build targets array), `protocols`,
`fileAssociations`, and `updater` — auto-update config consumed by
`useUpdate()` and `<UpdateButton />` (both from `murasaki`).

---

## Server Actions

React 19-style server actions — same shape as `useActionState`:

```ts
// src/actions.ts
'use server'
import { defineAction } from 'murasaki'
import type { ActionState } from 'murasaki'

export const greet = defineAction(
  async (_prev: ActionState<string>, formData: FormData): Promise<ActionState<string>> => {
    const name = formData.get('name')
    return { data: `Hello, ${name}!`, error: null, isPending: false }
  },
)
```

```tsx
// src/app/page.tsx
import { useAction } from 'murasaki'
import { greet } from '../actions'

export default function Home() {
  const [state, run, isPending] = useAction(greet, {
    data: null,
    error: null,
    isPending: false,
  })

  return (
    <form action={run}>
      <input name="name" />
      <button disabled={isPending}>Greet</button>
      {state.data && <p>{state.data}</p>}
    </form>
  )
}
```

`defineAction` is a typed passthrough that carries `'use server'` semantics
through TypeScript; `useAction` wraps React 19's `useActionState` directly, so
`[state, run, isPending]` is exactly the shape you already know from Next.js.
A Vite plugin detects the `'use server'` directive and splits the module: the
client gets a typed `fetch` stub, and the function itself runs on the
server — a Vite middleware in dev, a small bundled Node child server in prod.

---

## API Routes

Next.js-style file-based HTTP endpoints. A `src/api/<path>/route.ts` file
exports one function per HTTP method, served at `/api/<path>`:

```ts
// src/api/hello/route.ts  →  GET /api/hello
import type { RouteHandler } from 'murasaki'

export const GET: RouteHandler = async (request) => {
  return Response.json({ message: `Hello from Node ${process.version}` })
}

export const POST: RouteHandler = async (request) => {
  const body = await request.json()
  return Response.json({ received: body })
}
```

Dynamic segments use a `[name]` folder, exposed on `context.params`:

```ts
// src/api/greet/[name]/route.ts  →  GET /api/greet/:name
import type { RouteHandler } from 'murasaki'

export const GET: RouteHandler = async (_request, { params }) => {
  return Response.json({ greeting: `Hello, ${params.name}!` })
}
```

Handlers take a Web `Request` and return a Web `Response` (`Response.json`,
`new Response`, status codes, headers — all standard). They run on the server
in both dev (a Vite middleware) and prod (the bundled Node server), so they can
reach the filesystem, a database, or secrets. Call them with `fetch('/api/…')`
from your client.

**API routes vs. server actions** — both run on the server; pick by shape. API
routes are addressable HTTP endpoints (any client can `fetch` them — good for
webhooks, third-party callers, REST-ish surfaces). Server actions are typed RPC
wired into React 19's form / `useAction` flow (no URL, no `fetch` boilerplate).
They coexist.

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Your app (src/app/page.tsx, ...)       │  layouts, metadata, theming
├─────────────────────────────────────────┤
│  React 19 + Vite                        │  HMR, Fast Refresh, server-actions plugin
├─────────────────────────────────────────┤
│  murasaki (CLI + murasaki.config.ts)    │  dev / build / bundle / installer
├─────────────────────────────────────────┤
│  @murasakijs/native (Rust, via napi-rs) │  tao / wry / muda / rfd / arboard / notify-rust / open
├─────────────────────────────────────────┤
│  OS WebView                             │  WKWebView / WebView2 / WebKitGTK — no Chromium bundled
└─────────────────────────────────────────┘
```

---

## Roadmap

murasaki is **pre-1.0** — the API can still change before v1.0.

- ✅ **Phase B** — App Router essentially done: routing, Server Actions,
  metadata, middleware, and a dev error overlay all ship.
- ✅ **Phase C** — `@murasakijs/ui` component library, docs site, examples.
- ✅ **Windows packaging** — portable `.zip`, NSIS `.exe`, and `.msi`, all
  cross-compiled from macOS/Linux.
- ✅ **Auto-update** — signed manifests, SHA-256-verified downloads, and
  in-place replacement + relaunch on macOS and Windows x64.
- ✅ **Code signing** — macOS Developer ID + notarization and Windows
  Authenticode (PFX/store certificates or Microsoft Artifact Signing).
- 🚧 **Next** — Linux packaging, Windows arm64 auto-update, and v1.0 stabilization.
- 🔭 **Exploring (post-1.0):** server-side rendering + streaming. The current
  architecture renders entirely on the client, so this is a bigger
  architectural shift we're evaluating for after v1.0 rather than something
  planned for a near-term phase.

---

## Contributing

We welcome contributions of all kinds — code, docs, examples, bug reports,
feature requests. See [CONTRIBUTING.md](https://github.com/murasakijs/murasaki/blob/main/CONTRIBUTING.md) for the full
workflow.

Quick setup:

```bash
git clone https://github.com/murasakijs/murasaki.git
cd murasaki
pnpm install
pnpm --filter murasaki build

# only if you're hacking on the native binding (Rust) — most contributors don't need this
pnpm --filter @murasakijs/native build
# or: cd crates/native && pnpm build
```

## Code of Conduct

This project follows the Contributor Covenant. Read [CODE_OF_CONDUCT.md](https://github.com/murasakijs/murasaki/blob/main/CODE_OF_CONDUCT.md)
before participating.

## Security

Please **do not report security issues via public GitHub issues**. See
[SECURITY.md](https://github.com/murasakijs/murasaki/blob/main/SECURITY.md) for how to report responsibly.

## License

MIT © ichi — see [LICENSE](https://github.com/murasakijs/murasaki/blob/main/LICENSE).
