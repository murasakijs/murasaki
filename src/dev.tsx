// src/dev.tsx
// Murasaki dev runner — Next.js-like file-based routing without Next.js.
//
// Reads the consumer's app/ directory:
//   app/layout.tsx   (optional)
//   app/page.tsx     (required)
//
// Renders <Layout><Page /></Layout> with React, ships HTML to the WebView,
// and reloads in place on file change.

import { Application, ControlFlow } from '@webviewjs/webview'
import { existsSync, readFileSync, watch } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// ── ANSI ──────────────────────────────────────────────────────────────
const BRIGHT = '\x1b[38;2;168;85;247m'
const DIM    = '\x1b[38;2;136;136;153m'
const GREEN  = '\x1b[38;2;76;175;80m'
const RED    = '\x1b[38;2;239;68;68m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'
const noColor = process.env.NO_COLOR || !process.stdout.isTTY
const c = (code: string) => (noColor ? '' : code)

// ── Project paths ─────────────────────────────────────────────────────
const projectRoot = process.cwd()
const SRC_DIR     = join(projectRoot, 'src')
const APP_PATH    = join(SRC_DIR, 'app.tsx')
const LAYOUT_PATH = join(SRC_DIR, 'layout.tsx')

// ── Resolve murasaki version (for the banner) ─────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
let VERSION = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
  VERSION = pkg.version || '0.0.0'
} catch {}

const WEBVIEW_ENGINE = (() => {
  switch (process.platform) {
    case 'darwin': return 'WKWebView (macOS)'
    case 'win32':  return 'WebView2 (Windows)'
    case 'linux':  return 'WebKitGTK (Linux)'
    default:       return `OS native (${process.platform})`
  }
})()

const WIN_TITLE = 'Murasaki App'
const WIN_SIZE  = { width: 1280, height: 800 }
const START_AT  = Date.now()
const isDev     = process.env.MURASAKI_DEV === '1' || true  // dev runner always = dev

// ── Banner ────────────────────────────────────────────────────────────
function printBanner() {
  process.stdout.write('\n')
  process.stdout.write(`   ${c(BOLD)}${c(BRIGHT)}🦋 Murasaki${c(RESET)} ${c(DIM)}${VERSION}${c(RESET)}\n\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Project    ${c(RESET)}${projectRoot}\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Window     ${c(RESET)}${WIN_TITLE} ${c(DIM)}(${WIN_SIZE.width}×${WIN_SIZE.height})${c(RESET)}\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Webview    ${c(RESET)}${WEBVIEW_ENGINE}\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Runtime    ${c(RESET)}Node ${process.version}\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Mode       ${c(RESET)}development ${c(DIM)}(HMR active)${c(RESET)}\n\n`)
}
function printShortcuts() { process.stdout.write(`   ${c(DIM)}Shortcuts  ${c(RESET)}${c(BOLD)}o${c(RESET)} ${c(DIM)}open${c(RESET)}   ${c(BOLD)}r${c(RESET)} ${c(DIM)}restart${c(RESET)}   ${c(BOLD)}q${c(RESET)} ${c(DIM)}quit${c(RESET)}\n\n`) }
function printStarting() { process.stdout.write(` ${c(DIM)}○${c(RESET)} Starting...\n`) }
function printReady(ms: number) { process.stdout.write(` ${c(GREEN)}${c(BOLD)}✓${c(RESET)} ${c(BOLD)}Ready${c(RESET)} ${c(DIM)}in ${ms}ms${c(RESET)}\n`) }
function printOpened()   { process.stdout.write(` ${c(GREEN)}${c(BOLD)}✓${c(RESET)} Window opened\n`) }
function printClosed()   { process.stdout.write(` ${c(DIM)}○${c(RESET)} Window closed   ${c(DIM)}— press ${c(RESET)}${c(BOLD)}o${c(RESET)}${c(DIM)} to re-open, ${c(RESET)}${c(BOLD)}q${c(RESET)}${c(DIM)} to quit${c(RESET)}\n`) }
function printReloaded(file: string) { process.stdout.write(` ${c(BRIGHT)}${c(BOLD)}↻${c(RESET)} Reloaded ${c(DIM)}${file}${c(RESET)}\n`) }
function printBye()      { process.stdout.write(`\n ${c(DIM)}Bye 🦋${c(RESET)}\n\n`) }
function printHint(msg: string) { process.stdout.write(` ${c(DIM)}· ${msg}${c(RESET)}\n`) }
function printError(msg: string) { process.stdout.write(` ${c(RED)}${c(BOLD)}✗${c(RESET)} ${msg}\n`) }

// ── Routing: load app/page.tsx (+ optional app/layout.tsx) ────────────
type ReactComponent = ComponentType<{ children?: ReactNode }>

async function dynImport(path: string) {
  // Cache-bust so file edits are picked up without restarting the process.
  const url = pathToFileURL(path).href + `?v=${Date.now()}`
  return import(url)
}

async function loadApp(): Promise<ReactComponent | null> {
  if (!existsSync(APP_PATH)) return null
  const mod = await dynImport(APP_PATH)
  return mod.default as ReactComponent
}

async function loadLayout(): Promise<ReactComponent | null> {
  if (!existsSync(LAYOUT_PATH)) return null
  const mod = await dynImport(LAYOUT_PATH)
  return mod.default as ReactComponent
}

async function renderApp(): Promise<string> {
  const App = await loadApp()
  if (!App) {
    return '<!doctype html><html><body style="font-family:system-ui;padding:40px;"><h1 style="color:#A855F7">src/app.tsx not found</h1><p>Create one and the window will reload.</p></body></html>'
  }
  const Layout = await loadLayout()
  const appEl = createElement(App)
  const tree = Layout ? createElement(Layout, null, appEl) : appEl
  return '<!doctype html>' + renderToStaticMarkup(tree)
}

// ── Window lifecycle ──────────────────────────────────────────────────
const app = new Application({ controlFlow: ControlFlow.Wait })
let win: ReturnType<typeof app.createBrowserWindow> | null = null
let webview: ReturnType<NonNullable<typeof win>['createWebview']> | null = null

app.onEvent((event) => {
  const kind = event && ((event as any).kind || (event as any).event)
  if (kind === 'window-close-requested') {
    win = null
    webview = null
    printClosed()
  }
})

async function openWindow() {
  if (win) { printHint('Window is already open'); return }
  win = app.createBrowserWindow({
    title: WIN_TITLE,
    width: WIN_SIZE.width,
    height: WIN_SIZE.height,
  })
  webview = win.createWebview({ html: await renderApp() })
  printOpened()
}

function closeWindow() {
  if (!win) return
  try { win.dispose() } catch {}
  win = null
  webview = null
}

async function reload(triggerFile: string) {
  if (!webview) return
  try {
    webview.loadHtml(await renderApp())
    printReloaded(triggerFile.replace(projectRoot + '/', ''))
  } catch (e: any) {
    printError(`Reload failed: ${e.message}`)
  }
}

// ── File watcher (HMR for src/) ───────────────────────────────────────
function setupHmr() {
  if (!existsSync(SRC_DIR)) {
    printHint('src/ directory not found — nothing to watch')
    return
  }
  let debounce: NodeJS.Timeout | null = null
  let lastFile = ''
  try {
    watch(SRC_DIR, { recursive: true }, (_event, filename) => {
      if (!filename) return
      if (debounce) clearTimeout(debounce)
      lastFile = filename
      debounce = setTimeout(() => { reload(lastFile) }, 80)
    })
  } catch (e: any) {
    printHint(`HMR watcher failed: ${e.message}`)
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────
function setupShortcuts() {
  if (!process.stdin.isTTY) return
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (key: string) => {
    if (key === 'o' || key === 'O') {
      openWindow()
    } else if (key === 'r' || key === 'R') {
      closeWindow()
      openWindow()
    } else if (key === 'q' || key === 'Q' || key === '' /* Ctrl+C */) {
      printBye()
      try { process.stdin.setRawMode(false) } catch {}
      try { app.exit() } catch {}
      process.exit(0)
    }
  })
}

// ── Boot ──────────────────────────────────────────────────────────────
printBanner()
printShortcuts()
printStarting()
await openWindow()
printReady(Date.now() - START_AT)
setupShortcuts()
setupHmr()

app.run()
