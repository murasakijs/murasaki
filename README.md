# Murasaki 🟣

> The desktop framework for Next.js developers.
> Node-powered. WebView-thin. No Rust. No Chromium.

Murasaki lets you build desktop apps with the **Next.js DX you already know**,
on top of **Node.js you already use**, rendered through the **OS WebView
that's already on your machine** — no 150MB Chromium, no Rust.

```bash
npm create murasaki@latest my-app
cd my-app
npm run dev
```

```tsx
// app/page.tsx
'use client'

import { useClipboard, useNotification } from 'murasaki/native'

export default function Home() {
  const { copy } = useClipboard()
  const { show } = useNotification()

  return (
    <button onClick={async () => {
      await copy('hello from murasaki')
      show({ title: 'Copied!' })
    }}>
      Copy
    </button>
  )
}
```

That's it. Your Next.js app is now a desktop app. ~15MB binary.

---

## Why Murasaki?

|                     | **Murasaki**   | Electron | Tauri      | NW.js |
| ------------------- | -------------- | -------- | ---------- | ----- |
| Language            | TypeScript     | Node     | Rust + JS  | Node  |
| Binary size         | **~15MB**     | ~150MB   | ~5MB       | ~150MB|
| Rendering           | OS WebView     | Chromium | OS WebView | Chromium |
| Runtime             | **Node.js**   | Node.js  | Rust       | Node.js |
| Next.js integration | **★★★ native** | ★★      | ★ via SSG  | ★    |

Murasaki is the only framework that combines:

- 🟢 **Node.js you already know** (npm, package.json, async/await)
- 🪶 **Tauri-style lightweight** (OS WebView, no Chromium bundle)
- ⚡ **Next.js App Router** (RSC, Server Actions, file-based routing)
- 🪝 **Type-safe React hooks** for native APIs

---

## Architecture

```
┌─────────────────────────────────────┐
│  Your Next.js App                   │  ← App Router, RSC, Server Actions
├─────────────────────────────────────┤
│  Murasaki Native Hooks (React)      │  ← useClipboard, useNotification, etc.
├─────────────────────────────────────┤
│  Murasaki Runtime (Node.js)         │  ← IPC bridge, window lifecycle
├─────────────────────────────────────┤
│  OS Native WebView                  │  ← WebView2 / WKWebView / WebKitGTK
└─────────────────────────────────────┘
```

No Chromium. No Rust. No new runtime. Just Node + the WebView your OS ships with.

---

## What's NOT in Murasaki

- ❌ **A new runtime** — Node.js is the runtime
- ❌ **A Chromium bundle** — uses the OS WebView
- ❌ **Native widgets** — your UI is HTML/CSS/React in a WebView
- ❌ **Mobile** (yet) — desktop only for v0.x

If you want sub-MB binaries → Tauri.
If you want guaranteed cross-platform consistency → Electron.
If you want native widgets → Wails / NodeGui.

---

## Status

🌱 **Pre-alpha**. v0.1 targeted for 2026 Q4.

---

## License

MIT.
