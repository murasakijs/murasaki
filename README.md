<div align="center">

# 🦋 Murasaki

**The desktop framework for Next.js developers.**

Node-powered · WebView-thin · No Rust · No Chromium

[![npm version](https://img.shields.io/npm/v/murasaki?color=A855F7&label=npm)](https://www.npmjs.com/package/murasaki)
[![license](https://img.shields.io/npm/l/murasaki?color=A855F7)](./LICENSE)

</div>

---

Murasaki is a TypeScript-first desktop framework with a **Next.js-inspired DX**:
file-based routing, layouts, metadata, in-window HMR — all on plain Node.js,
rendered through the **OS WebView that ships with your machine**.

```bash
pnpm create murasaki@latest my-app
cd my-app
pnpm dev
```

```tsx
// src/app/page.tsx
import { Button, Card, Text } from 'murasaki'
import { useNotification, useState } from 'murasaki/jsx/dom'

export default function Home() {
  const [count, setCount] = useState(0)
  const notify = useNotification()

  return (
    <Card>
      <Text size={24} weight="bold">Count: {count}</Text>
      <Button onClick={() => setCount(count + 1)}>+</Button>
      <Button variant="secondary" onClick={() => notify({ title: 'Hello' })}>
        🔔 Notify
      </Button>
    </Card>
  )
}
```

That's it. Your TypeScript app is now a desktop app. **~15 MB binary**,
**Node.js runtime**, **macOS / Windows / Linux**.

---

## Philosophy

> Not "**Next.js running on desktop**" — **"the Next.js feel, on desktop."**

Murasaki borrows ideas that made Next.js comfortable to use — file-based
routing, metadata, dev reload, TypeScript-first — but it isn't a Next.js
port. The core (WebView management, IPC bridge, native APIs) is its own,
and the renderer is decoupled so future versions can switch JSX engines.

---

## Why Murasaki?

|                     | **Murasaki**       | Electron     | Tauri          | NW.js     |
| ------------------- | ------------------ | ------------ | -------------- | --------- |
| Language            | TypeScript         | TypeScript   | Rust + JS      | JS        |
| Binary size         | **~15 MB**         | ~150 MB      | ~5 MB          | ~150 MB   |
| Rendering           | OS WebView         | Chromium     | OS WebView     | Chromium  |
| Runtime             | **Node.js**        | Node.js      | Rust           | Node.js   |
| Next.js-style DX    | ★★★ native         | ★★           | ★ via SSG      | ★         |
| Built-in components | **34 + 12 hooks**  | none         | none           | none      |
| Auto-publish CI    | **Trusted Publisher** | manual    | manual         | manual    |

Murasaki is the only framework that combines:

- 🟢 **Node.js you already know** (npm, package.json, async/await)
- 🪶 **Tauri-style lightweight** (OS WebView, no Chromium bundle)
- ⚛️ **React-like JSX** (own runtime — no React dependency)
- 🎨 **34 batteries-included components** with theme tokens
- 🪝 **12 hooks** for state + native APIs

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Your App  (src/app/page.tsx)           │  file-based routing, metadata
├─────────────────────────────────────────┤
│  Murasaki Components                    │  Button / Card / Modal / Toast / …
│  Murasaki Hooks (jsx/dom)               │  useState / useNotification / …
├─────────────────────────────────────────┤
│  murasaki/jsx + murasaki/jsx/dom        │  SSR + client hydration runtime
├─────────────────────────────────────────┤
│  IPC bridge (window.murasaki)           │  Promise-based, typed
├─────────────────────────────────────────┤
│  Murasaki Runtime (Node.js)             │  window lifecycle, file watcher, esbuild bundling
├─────────────────────────────────────────┤
│  OS Native WebView                      │  WKWebView / WebView2 / WebKitGTK
└─────────────────────────────────────────┘
```

No Chromium. No Rust. No new runtime. Just Node + the WebView your OS already
has, plus a thin TypeScript layer that gives you the Next.js you wished you
could `npm create` for a desktop app.

---

## Components (34)

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
```

All components share a single set of theme tokens (CSS custom properties),
flip with `<ThemeProvider theme="auto" | dark | light>`, and accept
`className` + `style` for full override.

---

## Hooks (12)

```ts
import {
  // React-like (3)
  useState, useEffect, useRef,

  // Native bridge (9)
  useNotification,  // OS notification banner
  useClipboard,     // system clipboard r/w
  useShell,         // openExternal (URL / file)
  useFs,            // readFile / writeFile / exists / readDir
  useDialog,        // openFile / openDirectory / saveFile (native dialogs)
  useWindow,        // minimize / maximize / setTitle / setSize / etc.
} from 'murasaki/jsx/dom'

import { useToast, toast } from 'murasaki'  // in-app toasts
```

All native hooks are server-import safe — they degrade to no-op during SSR
and hydrate to real implementations on the client.

---

## What's NOT in Murasaki (yet)

- ❌ **Native widgets** — UI is HTML/CSS/JSX in a WebView (by design)
- ❌ **Mobile** — desktop only for v0.x
- ❌ **Tray icon API** — planned for v0.13
- ❌ **`murasaki build`** (binary packaging) — planned for v0.14

If you want sub-MB binaries → **Tauri**.
If you want Chromium guaranteed → **Electron**.
If you want native widgets → **NodeGUI / Flutter**.

If you want **"Next.js DX without a separate runtime"** → **Murasaki**.

---

## Publishing your package

Murasaki itself ships with **GitHub Actions + npm Trusted Publisher OIDC**
so a `git push --tags` triggers a signed `npm publish --provenance` with
zero OTP. The template doesn't include this by default (most apps publish
binaries, not npm packages), but the pattern is in `.github/workflows/release.yml`
of this repo if you want to copy it.

---

## Status

🌱 **Pre-alpha** (`v0.12.x`).
Public API not yet stable — minor versions may break things. Pin exact
versions or `~0.x` until v1.0.

---

## License

MIT © ichi
