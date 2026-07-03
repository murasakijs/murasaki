<div align="center">

<img src="./assets/logo.svg" alt="Murasaki — the desktop framework for Next.js developers" width="720">

**The desktop framework for Next.js developers.**

React 19 · Vite · OS WebView · Rust-native · No Chromium

[![npm version](https://img.shields.io/npm/v/murasaki?color=A855F7&label=npm)](https://www.npmjs.com/package/murasaki)
[![npm downloads](https://img.shields.io/npm/dm/murasaki?color=A855F7)](https://www.npmjs.com/package/murasaki)
[![license](https://img.shields.io/npm/l/murasaki?color=A855F7)](./LICENSE)
[![CI](https://github.com/murasakijs/murasaki/actions/workflows/release.yml/badge.svg)](https://github.com/murasakijs/murasaki/actions)

[English](./README.md) · [日本語](./README.ja.md)

</div>

---

Murasaki is a TypeScript-first desktop framework with a **Next.js-inspired DX**:
file-based project layout, layouts, metadata, and React 19 server actions,
built on **React 19 + Vite**, rendered through the **OS WebView already
installed on your machine** — no bundled Chromium. The native window, menus,
and OS integrations are powered by a self-authored Rust binding,
[`@murasakijs/native`](https://www.npmjs.com/package/@murasakijs/native) —
you write TypeScript; you never write Rust. Targets **macOS / Windows / Linux**.

```bash
npm create murasaki@latest my-app
cd my-app
npm run dev
```

```tsx
// src/app/page.tsx
import { useState } from 'react'
import { useGlobalContextMenu } from 'murasaki'

export default function Page() {
  const [count, setCount] = useState(0)

  useGlobalContextMenu(
    [
      { id: 'reload', label: 'Reload', accelerator: 'CmdOrCtrl+R' },
      { role: 'separator' },
      { role: 'copy' },
      { role: 'paste' },
    ],
    (id) => {
      if (id === 'reload') location.reload()
    },
  )

  return (
    <main>
      <h1>Hello, Murasaki 🦋</h1>
      <button onClick={() => setCount((n) => n + 1)}>Clicked {count} times</button>
    </main>
  )
}
```

That's a real Vite dev server with React Fast Refresh, rendered in a native
window — and right-clicking anywhere shows a **real OS context menu** (NSMenu
on macOS, HMENU on Windows, GtkMenu on Linux), not an HTML popup.

---

## Table of Contents

- [Quick start](#quick-start)
- [Why murasaki?](#why-murasaki)
- [Features](#features)
- [CLI reference](#cli-reference)
- [Configuration (`murasaki.config.ts`)](#configuration-murasakiconfigts)
- [Server Actions](#server-actions)
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

# ship (verified on macOS today — see CLI reference)
npm run build       # dist/client            Vite production build
npm run bundle      # dist/bundle/<App>.app  ~120 MB (bundles Node + your app)
npm run installer   # dist/<App>-<ver>.dmg   ~43 MB compressed
```

The scaffold gives you a React 19 + Vite + Tailwind app with a Next.js-like
layout — you only touch `src/app/` (pages, layouts, `globals.css`), `src/api/`
(server actions), and `src/middleware.ts`. There's no `index.html` or entry
file to maintain: murasaki owns the app shell and the client bootstrap (drop
your own `index.html` in the project root if you want to customize the HTML
head). `murasaki.config.ts` describes your app's identity and window.

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
- **Native context menu.** `useGlobalContextMenu()` posts to the Rust side,
  which pops a real OS menu (NSMenu / HMENU / GtkMenu) and dispatches the
  clicked item back as a DOM `CustomEvent` — no HTML popup involved.
- **Native menus, dialogs, clipboard, notifications, shell.** Built on
  [`@murasakijs/native`](https://www.npmjs.com/package/@murasakijs/native):
  open/save/directory dialogs, clipboard read/write, OS notifications, and
  "reveal in Finder/Explorer" — all typed, no Rust required to call them.
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
- **Packaging on macOS (verified).** `murasaki bundle` → `.app`,
  `murasaki installer` → `.dmg` (~43 MB compressed; the `.app` itself is
  ~120 MB because it bundles Node + your app).
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

**Platform status:** `murasaki dev` works on macOS, Windows, and Linux.
`murasaki bundle` and `murasaki installer` are implemented and verified on
**macOS** (`.app` / `.dmg`) today; on other platforms they currently print a
"not supported yet" message rather than producing an installer.
[`@murasakijs/native`](https://www.npmjs.com/package/@murasakijs/native)
itself already ships prebuilt binaries for macOS (arm64/x64), Windows (x64),
and Linux (x64/arm64) — Windows/Linux app packaging is tracked in the
[Roadmap](#roadmap).

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
})
```

`MurasakiConfig` also accepts an optional `devPort` (Vite dev server port,
default `5178`), `targets` (build targets array), and `updater` (config
consumed by `useUpdate` / `UpdateButton`).

---

## Server Actions

React 19-style server actions — same shape as `useActionState`:

```ts
// src/api/actions.ts
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
import { greet } from '../api/actions'

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

murasaki is **pre-1.0** (currently `0.34.4`) — the API can still change
before v1.0.

- ✅ **Phase B** — App Router essentially done: routing, Server Actions,
  metadata, middleware, and a dev error overlay all ship.
- 🚧 **Phase C** — `@murasakijs/ui` component library, docs site, examples.
- 🚧 **Phase D** — auto-update, code signing/notarization, Windows/Linux
  packaging, v1.0 stabilization.
- 🔭 **Exploring (post-1.0):** server-side rendering + streaming. The current
  architecture renders entirely on the client, so this is a bigger
  architectural shift we're evaluating for after v1.0 rather than something
  planned for a near-term phase.

---

## Contributing

We welcome contributions of all kinds — code, docs, examples, bug reports,
feature requests. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full
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

This project follows the Contributor Covenant. Read [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
before participating.

## Security

Please **do not report security issues via public GitHub issues**. See
[SECURITY.md](./SECURITY.md) for how to report responsibly.

## License

MIT © ichi — see [LICENSE](./LICENSE).
