#!/usr/bin/env node
// murasaki production launcher — spawns prod-server.mjs (a small Node HTTP
// server that serves the built client and runs 'use server' actions out of
// the dist/server registry, see that file) as a child process, then points
// the native WebView at it over http://127.0.0.1:<port>/. This mirrors
// `murasaki dev` (src/cli/dev.ts spawns Vite the same way) closely enough
// that the client's `/__murasaki/action/…` fetch works unchanged in both —
// the murasaki:// custom protocol (crates/native) is no longer used here.
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const meta = JSON.parse(await readFile(join(__dirname, 'murasaki-meta.json'), 'utf8'))
// The bundled `node` binary is otherwise the process's own name (visible in
// the bold macOS app menu and the About panel) — prefer the product name.
process.title = meta.productName
// Localized labels for the standard App/Edit/Window menu bar. Resolved here
// (rather than at build time) so this reflects the *end user's* runtime
// locale, not the build machine's — see src/menu-i18n.ts, whose
// detectLocale()/resolveMenuLabels() logic is mirrored below since this
// launcher ships standalone (same reasoning as prod-server.mjs).
const menuLocales = JSON.parse(await readFile(join(__dirname, 'menu-locales.json'), 'utf8'))

const server = spawn(
  process.execPath,
  [
    join(__dirname, 'prod-server.mjs'),
    '--client', join(__dirname, 'client'),
    '--registry', join(__dirname, 'server/actions.mjs'),
    '--routes', join(__dirname, 'server/routes.mjs'),
    '--port', '0',
  ],
  { cwd: __dirname, stdio: ['ignore', 'pipe', 'inherit'] },
)

const shutdown = () => {
  server.kill()
}

let port
try {
  port = await waitForPort(server, 15_000)
} catch (err) {
  shutdown()
  throw err
}

const url = `http://127.0.0.1:${port}/`
try {
  await waitForServer(url, 15_000)
} catch (err) {
  shutdown()
  throw err
}

const native = require('@murasakijs/native')
const app = new native.Application()
const webview = app.createWebview(
  {
    title: meta.productName,
    width: meta.width ?? 1000,
    height: meta.height ?? 700,
    vibrancy: meta.vibrancy ?? null,
    icon: meta.icon ? join(__dirname, meta.icon) : undefined,
    version: meta.version,
    description: meta.description,
    copyright: meta.copyright,
    homepage: meta.homepage,
    authors: meta.authors,
    menuLabels: resolveMenuLabels(meta.productName),
  },
  { url, devtools: false },
)
webview.onIpcMessage(() => {})
app.onQuit(() => {
  shutdown()
  process.exit(0)
})
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', shutdown)

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

/**
 * prod-server.mjs is started with `--port 0` (OS-assigned) since the
 * launcher doesn't know a free port ahead of time — it reports the port it
 * actually bound by printing `MURASAKI_PORT=<n>` to stdout once listening
 * (see that file). Buffers stdout until that line shows up, then resumes
 * forwarding the child's output straight through.
 */
function waitForPort(child, timeoutMs) {
  return new Promise((resolveOk, rejectFail) => {
    let buf = ''
    let settled = false
    const onData = (chunk) => {
      buf += chunk.toString()
      const m = buf.match(/MURASAKI_PORT=(\d+)/)
      if (m && !settled) {
        settled = true
        child.stdout.off('data', onData)
        child.stdout.pipe(process.stdout)
        resolveOk(Number(m[1]))
      }
    }
    child.stdout.on('data', onData)
    child.once('exit', (code) => {
      if (!settled) rejectFail(new Error(`prod server exited with code ${code}`))
    })
    setTimeout(() => {
      if (!settled) rejectFail(new Error('prod server did not report a port in time'))
    }, timeoutMs)
  })
}

/**
 * Resolves the native menu labels for `productName`, localized for the
 * detected system language. Mirrors src/menu-i18n.ts's resolveMenuLabels().
 */
function resolveMenuLabels(productName, locale = detectLocale()) {
  const t = menuLocales[locale] ?? menuLocales.en
  const fill = (s) => s.split('{app}').join(productName)
  return {
    about: fill(t.about),
    services: t.services,
    hide: fill(t.hide),
    hideOthers: t.hideOthers,
    showAll: t.showAll,
    quit: fill(t.quit),
    edit: t.edit,
    undo: t.undo,
    redo: t.redo,
    cut: t.cut,
    copy: t.copy,
    paste: t.paste,
    selectAll: t.selectAll,
    window: t.window,
    minimize: t.minimize,
    zoom: t.zoom,
  }
}

/**
 * Best-effort system UI language, normalized to a shipped locale key. Mirrors
 * src/menu-i18n.ts's detectLocale().
 */
function detectLocale() {
  const raw = macosUiLanguage() ?? runtimeLocale() ?? envLocale() ?? 'en'
  return normalizeLocale(raw)
}

function macosUiLanguage() {
  if (process.platform !== 'darwin') return undefined
  try {
    const out = execSync('defaults read -g AppleLanguages', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.match(/[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*/)?.[0]
  } catch {
    return undefined
  }
}

function runtimeLocale() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

function envLocale() {
  const v = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG
  // "ja_JP.UTF-8" carries the language; "C"/"POSIX" mean "no locale" → skip.
  return v && v !== 'C' && v !== 'POSIX' ? v : undefined
}

function normalizeLocale(raw) {
  const lc = raw.toLowerCase().replace('_', '-')
  if (lc.startsWith('ja')) return 'ja'
  if (lc.startsWith('zh')) return 'zh-CN'
  if (lc.startsWith('ko')) return 'ko'
  if (lc.startsWith('es')) return 'es'
  if (lc.startsWith('fr')) return 'fr'
  if (lc.startsWith('de')) return 'de'
  return 'en'
}

/**
 * Same readiness probe as murasaki dev (src/cli/dev.ts's waitForServer) —
 * poll the exact URL the webview will load until it answers.
 */
function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolveOk, rejectFail) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolveOk()
      })
      req.setTimeout(1000, () => req.destroy(new Error('probe timeout')))
      req.once('error', () => {
        if (Date.now() >= deadline)
          return rejectFail(new Error(`prod server did not serve ${url} in time`))
        setTimeout(tryOnce, 100)
      })
    }
    tryOnce()
  })
}
