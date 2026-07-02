#!/usr/bin/env node
// murasaki production launcher — serves the client via the native custom
// protocol (no HTTP server; Node's event loop is blocked by app.run(), so an
// in-process server can't work — the Rust side serves files instead).
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const meta = JSON.parse(await readFile(join(__dirname, 'murasaki-meta.json'), 'utf8'))

const native = require('@murasakijs/native')
const app = new native.Application()
const webview = app.createWebview(
  {
    title: meta.productName,
    width: meta.width ?? 1000,
    height: meta.height ?? 700,
    vibrancy: meta.vibrancy ?? null,
    icon: meta.icon ? join(__dirname, meta.icon) : undefined,
  },
  { serveDir: join(__dirname, 'client'), devtools: false },
)
webview.onIpcMessage(() => {})
app.onQuit(() => process.exit(0))

// Dock/About-panel icon. Info.plist's CFBundleIconFile covers the .app's
// Finder/DMG appearance, but this process is the bundled `node` binary
// (not a "real" app executable) — set NSApp.applicationIconImage explicitly
// so the running app also shows the icon.
if (meta.icon) {
  try {
    app.setIconPath(join(__dirname, meta.icon))
  } catch {}
}

app.run()
