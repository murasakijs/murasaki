<div align="center">

<img src="./assets/logo.svg" alt="Murasaki — the desktop framework for Next.js developers" width="720">

**The desktop framework for Next.js developers.**

Node-powered · WebView-thin · No Rust · No Chromium

[![npm version](https://img.shields.io/npm/v/murasaki?color=A855F7&label=npm)](https://www.npmjs.com/package/murasaki)
[![npm downloads](https://img.shields.io/npm/dm/murasaki?color=A855F7)](https://www.npmjs.com/package/murasaki)
[![license](https://img.shields.io/npm/l/murasaki?color=A855F7)](./LICENSE)
[![CI](https://github.com/murasakijs/murasaki/actions/workflows/release.yml/badge.svg)](https://github.com/murasakijs/murasaki/actions)

[English](./README.md) · [日本語](./README.ja.md)

</div>

---

Murasaki is a TypeScript-first desktop framework with a **Next.js-inspired DX**:
file-based routing, layouts, metadata, in-window HMR, server actions — all on
plain Node.js, rendered through the **OS WebView that ships with your machine**.

```bash
pnpm create murasaki@latest my-app
cd my-app
pnpm dev
```

```tsx
// src/app/page.tsx
import { Button, Card, Text, useAction } from 'murasaki'
import { useState } from 'murasaki/jsx/dom'
import type { greet } from '../actions'

export default function Home() {
  const [count, setCount] = useState(0)
  const g = useAction<typeof greet>('greet')

  return (
    <Card>
      <Text size={24} weight="bold">Count: {count}</Text>
      <Button onClick={() => setCount(count + 1)}>+</Button>
      <Button variant="secondary" onClick={() => g.call('world')}>
        Greet from Node
      </Button>
      {g.data && <Text>{g.data}</Text>}
    </Card>
  )
}
```

That's it. Your TypeScript app is now a desktop app. **macOS / Windows / Linux**,
producible as `.app` / `.dmg` / `.msi` / `.AppImage` / `.zip` / `.tar.gz` — all
from any host OS.

---

## Table of Contents

- [Quick start](#quick-start)
- [Why Murasaki?](#why-murasaki)
- [Features](#features)
- [CLI reference](#cli-reference)
- [Configuration (`murasaki.config.ts`)](#configuration-murasakiconfigts)
- [Server Actions](#server-actions)
- [Cross-compile matrix](#cross-compile-matrix)
- [Components (34) & Hooks (13)](#components-34--hooks-13)
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
pnpm create murasaki@latest my-app

# develop with HMR
cd my-app
pnpm dev

# ship
pnpm build          # dist/server.cjs                    (~400 KB)
pnpm bundle         # dist/<App>.app                     (~120 MB)
pnpm installer      # dist/<App>-<ver>.dmg               (~43 MB compressed)

# cross-compile
pnpm exec murasaki installer --target win-x64      # → .msi (needs WiX v4)
pnpm exec murasaki installer --target linux-x64    # → .AppImage (needs squashfs)
```

---

## Why Murasaki?

|                     | **Murasaki**       | Electron     | Tauri          | NW.js     |
| ------------------- | ------------------ | ------------ | -------------- | --------- |
| Language            | TypeScript         | TypeScript   | Rust + JS      | JS        |
| Rendering           | OS WebView         | Chromium     | OS WebView     | Chromium  |
| Runtime             | **Node.js**        | Node.js      | Rust           | Node.js   |
| Installer size      | **~40 MB**         | ~90 MB       | ~5 MB          | ~110 MB   |
| Next.js-style DX    | ★★★ native         | ★★           | ★ via SSG      | ★         |
| Built-in components | **34 + 13 hooks**  | none         | none           | none      |
| Server actions      | **`defineAction`** | manual IPC   | manual IPC     | manual    |
| Cross-compile       | **built-in `--target`** | manual  | matrix         | manual    |
| Auto-publish CI     | **Trusted Publisher OIDC** | manual | manual     | manual    |

Murasaki is the only framework that combines:

- 🟢 **Node.js you already know** (npm, package.json, async/await)
- 🪶 **Tauri-style lightweight** (OS WebView — no Chromium bundle)
- ⚛️ **React-like JSX** (own runtime — no React dependency)
- 🎨 **Batteries-included components** with theme tokens
- 🔧 **Full toolchain**: dev → build → bundle → installer, all shipped

---

## Features

- **File-based routing.** `src/app/**/page.tsx` becomes routes automatically.
- **HMR out of the box.** Save a file, the window reloads. Native menu keeps working.
- **JSX renderer without React.** Own `jsx/` + `jsx/dom/` runtime.
- **Batteries-included UI.** 34 components sharing one theme token system.
- **Server Actions.** `defineAction` on the server, `useAction` on the client, typed end-to-end.
- **Multi-window.** `useWindow` + `openWindow()` API.
- **Native APIs.** Notifications, clipboard, dialogs, filesystem, shell, tray icon.
- **Cross-compile.** From a macOS host, produce `.dmg`, `.msi`, `.AppImage`, `.zip`, `.tar.gz`.
- **Trusted Publisher OIDC.** Tag-push triggers signed `npm publish --provenance`.

---

## CLI reference

```
murasaki dev                       Start the development server (HMR)
murasaki build                     Production JS bundle → dist/server.cjs
murasaki bundle                    Native folder / .app for the current OS
murasaki installer                 Distributable archive / installer for the current OS
```

All build subcommands accept `--target <id>` for cross-compile:

```
--target darwin-arm64    (default on Apple Silicon)
--target darwin-x64
--target win-x64
--target win-arm64
--target linux-x64
--target linux-arm64
```

The Node binary and `@webviewjs/webview` prebuild for the requested target
are downloaded on demand and cached under `~/.murasaki/cache/`.

---

## Configuration (`murasaki.config.ts`)

```ts
import { defineConfig } from 'murasaki'

export default defineConfig({
  name: 'My App',                             // display name (macOS .app title)
  bundleId: 'com.example.myapp',              // reverse-DNS identifier
  description: 'A murasaki app',
  copyright: '© 2026 Example, Inc.',
  icon: 'assets/icon.icns',                   // .icns / .ico / .png
  category: 'public.app-category.productivity',
  targets: ['darwin-arm64', 'win-x64', 'linux-x64'],
  window: {
    title: 'My App',
    width: 1280,
    height: 800,
  },
})
```

Lookup order (first match wins): `murasaki.config.ts` → `murasaki.config.js`
→ `murasaki.config.json` → `package.json`'s `"murasaki"` field.

---

## Server Actions

```ts
// src/actions.ts — server side
import { defineAction } from 'murasaki'

export const greet = defineAction('greet', async (name: string) => {
  return `Hello, ${name}! (Node ${process.version})`
})
```

```tsx
// src/app/page.tsx — client side
import { useAction } from 'murasaki'
import type { greet } from '../actions'   // types only

export default function Home() {
  const g = useAction<typeof greet>('greet')

  return (
    <>
      <Button onClick={() => g.call('world')}>Greet</Button>
      {g.loading ? '…' : g.data}
      {g.error && <Text color="red">{g.error.message}</Text>}
    </>
  )
}
```

Behind the scenes: `window.ipc.postMessage` → `webview.onIpcMessage` on the
server, results returned via `webview.evaluate` — no additional native
bridge needed.

---

## Cross-compile matrix

| Output     | Where you can build it        | Consumer install                           |
| ---------- | ----------------------------- | ------------------------------------------ |
| `.dmg`     | **macOS host only**           | `hdiutil` (built into macOS)               |
| `.msi`     | any host + WiX v4             | `dotnet tool install -g wix`               |
| `.AppImage`| any host + squashfs-tools     | `brew install squashfs` / `apt install squashfs-tools` |
| `.zip`     | any host                      | built-in (`zip` / `Compress-Archive`)      |
| `.tar.gz`  | any host                      | built-in (`tar`)                           |

From a macOS host with WiX and squashfs installed, **one machine builds all
four platforms' installers**. If a required tool isn't present, murasaki
falls back to `.zip` / `.tar.gz` with an install hint — never a hard failure.

---

## Components (34) & Hooks (13)

```ts
import {
  // Layout (4)
  View, Row, Stack, Text,

  // Desktop shell (7)
  TitleBar, NoDrag, Sidebar, SidebarItem, Toolbar, StatusBar, Pane,

  // UI Tier 1 (7)
  Button, Card, Input, Textarea, Modal, List, ListItem,

  // UI Tier 2 (10)
  Switch, Checkbox, Radio, RadioGroup,
  Tooltip, Tabs, TabList, Tab, TabPanel, ContextMenu,

  // UI Tier 3 (5)
  Badge, Avatar, Spinner, Progress, ToastProvider,

  // Routing (1)
  Link,

  // Theme
  ThemeProvider, useTheme,
} from 'murasaki'

import {
  // React-like (3)
  useState, useEffect, useRef,

  // Native bridge (10)
  useNotification, useClipboard, useShell, useFs, useDialog,
  useWindow, useTray, useAction, useToast, toast,
} from 'murasaki/jsx/dom'
```

All components share one set of theme tokens (CSS custom properties), flip
with `<ThemeProvider theme="auto" | "dark" | "light">`, and accept `className`
+ `style` for full override. All native hooks are server-import safe — they
degrade to no-op during SSR.

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Your App (src/app/page.tsx)            │  file-based routing, metadata
├─────────────────────────────────────────┤
│  Murasaki Components + Hooks            │  Button / Card / Modal / …
│                                         │  useState / useAction / useNotification
├─────────────────────────────────────────┤
│  Server Actions (defineAction)          │  RPC dispatcher over wry IPC
├─────────────────────────────────────────┤
│  Client bundle (jsx/dom)                │  own JSX runtime, no React
├─────────────────────────────────────────┤
│  Native bridge (window.murasaki)        │  Promise-based, typed
├─────────────────────────────────────────┤
│  Murasaki Runtime (Node.js)             │  window lifecycle, HMR, esbuild
├─────────────────────────────────────────┤
│  OS Native WebView                      │  WKWebView / WebView2 / WebKitGTK
└─────────────────────────────────────────┘
```

No Chromium. No Rust. No new runtime. Just Node + the WebView your OS
already ships, plus a thin TypeScript layer.

---

## Roadmap

- 🚧 UI Tier 4 (`DataTable`, `Slider`, `DatePicker`, `Skeleton`)
- 🚧 Auto-update channel
- 🚧 Icon generator (single PNG → `.icns` / `.ico` / `.png` set)
- 🚧 Docs site (`https://murasaki.dev`)
- 🚧 v1.0 API stabilization

---

## Contributing

We welcome contributions of all kinds — code, docs, examples, bug reports,
feature requests. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get
set up and what workflow to follow.

Quick setup:

```bash
git clone https://github.com/murasakijs/murasaki.git
cd murasaki
pnpm install
pnpm --filter murasaki tsc -p tsconfig.build.json
cd examples/app-router
pnpm dev
```

## Code of Conduct

This project follows the Contributor Covenant. Read [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
before participating.

## Security

Please **do not report security issues via public GitHub issues**. See
[SECURITY.md](./SECURITY.md) for how to report responsibly.

## License

MIT © ichi — see [LICENSE](./LICENSE).
