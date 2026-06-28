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
const SRC_DIR        = join(projectRoot, 'src')
const APP_PATH       = join(SRC_DIR, 'app.tsx')
const LAYOUT_PATH    = join(SRC_DIR, 'layout.tsx')
const GLOBALS_CSS    = join(SRC_DIR, 'globals.css')

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

const DEFAULT_WIN_TITLE = 'Murasaki App'
const DEFAULT_WIN_SIZE  = { width: 1280, height: 800 }
const START_AT          = Date.now()
const isDev             = process.env.MURASAKI_DEV === '1' || true  // dev runner always = dev

// Active window config (mutated when metadata is read)
let winTitle = DEFAULT_WIN_TITLE
let winSize  = { ...DEFAULT_WIN_SIZE }

// ── Banner ────────────────────────────────────────────────────────────
function printBanner() {
  process.stdout.write('\n')
  process.stdout.write(`   ${c(BOLD)}${c(BRIGHT)}🦋 Murasaki${c(RESET)} ${c(DIM)}${VERSION}${c(RESET)}\n\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Project    ${c(RESET)}${projectRoot}\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Window     ${c(RESET)}${winTitle} ${c(DIM)}(${winSize.width}×${winSize.height})${c(RESET)}\n`)
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

type AppMetadata = {
  title?: string
  description?: string
  window?: { title?: string; width?: number; height?: number }
}

type LayoutModule = { component: ReactComponent; metadata?: AppMetadata } | null

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

async function loadLayout(): Promise<LayoutModule> {
  if (!existsSync(LAYOUT_PATH)) return null
  const mod = await dynImport(LAYOUT_PATH)
  if (!mod.default) return null
  return { component: mod.default as ReactComponent, metadata: mod.metadata as AppMetadata | undefined }
}

function loadGlobalsCss(): string {
  if (!existsSync(GLOBALS_CSS)) return ''
  try { return readFileSync(GLOBALS_CSS, 'utf8') } catch { return '' }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function renderApp(): Promise<{ html: string; metadata?: AppMetadata }> {
  const App = await loadApp()
  if (!App) {
    return { html: '<!doctype html><html><body style="font-family:system-ui;padding:40px;"><h1 style="color:#A855F7">src/app.tsx not found</h1><p>Create one and the window will reload.</p></body></html>' }
  }
  const layoutData = await loadLayout()
  const metadata = layoutData?.metadata
  const appEl = createElement(App)
  const tree = layoutData ? createElement(layoutData.component, null, appEl) : appEl
  let html = '<!doctype html>' + renderToStaticMarkup(tree)

  // Inject <title> + <meta description> from metadata if not present in head
  const headInjects: string[] = []
  if (metadata?.title && !/<title>.*?<\/title>/i.test(html)) {
    headInjects.push(`<title>${escapeHtml(metadata.title)}</title>`)
  }
  if (metadata?.description && !/<meta[^>]+name=["']description["']/i.test(html)) {
    headInjects.push(`<meta name="description" content="${escapeHtml(metadata.description)}">`)
  }

  // Inject src/globals.css (auto, like Next.js's import './globals.css')
  const css = loadGlobalsCss()
  if (css) {
    headInjects.push(`<style data-murasaki="globals.css">${css}</style>`)
  }

  if (headInjects.length) {
    const blob = headInjects.join('')
    if (html.includes('</head>')) {
      html = html.replace('</head>', blob + '</head>')
    } else {
      html = html.replace('<body', blob + '<body')
    }
  }

  return { html, metadata }
}

// ── Window lifecycle ──────────────────────────────────────────────────
const app = new Application({ controlFlow: ControlFlow.Wait })
let win: ReturnType<typeof app.createBrowserWindow> | null = null
let webview: ReturnType<NonNullable<typeof win>['createWebview']> | null = null

app.onEvent((event) => {
  const kind = event && ((event as any).kind || (event as any).event)
  if (kind === 'window-close-requested') {
    // Dispose the window so the OS close completes — without this the
    // close button hangs / appears frozen.
    if (win) {
      try { win.dispose() } catch {}
    }
    win = null
    webview = null
    printClosed()
  }
})

function applyMetadataToWindowConfig(metadata?: AppMetadata) {
  if (!metadata) return
  if (metadata.window?.title) winTitle = metadata.window.title
  else if (metadata.title)    winTitle = metadata.title
  if (metadata.window?.width)  winSize.width  = metadata.window.width
  if (metadata.window?.height) winSize.height = metadata.window.height
}

async function openWindow() {
  if (win) { printHint('Window is already open'); return }
  // Render first so we can read metadata and apply window config
  const { html, metadata } = await renderApp()
  applyMetadataToWindowConfig(metadata)
  win = app.createBrowserWindow({
    title: winTitle,
    width: winSize.width,
    height: winSize.height,
  })
  webview = win.createWebview({ html })
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
    const { html } = await renderApp()
    webview.loadHtml(html)
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
