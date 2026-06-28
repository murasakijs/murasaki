// examples/hello/index.mjs
// Murasaki — Hello World with Next.js-style dev banner + keyboard shortcuts
//
// Run with:  pnpm dev   (or  npm run dev,  or  node examples/hello/index.mjs)
//
// Keyboard shortcuts (in the terminal):
//   o   open the window (re-open after close)
//   r   restart the window (close + open)
//   q   quit
//   Ctrl+C   quit

import { Application, ControlFlow } from '@webviewjs/webview'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── ANSI ──────────────────────────────────────────────────────────────
const BRIGHT = '\x1b[38;2;168;85;247m'
const DIM    = '\x1b[38;2;136;136;153m'
const GREEN  = '\x1b[38;2;76;175;80m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

const noColor = process.env.NO_COLOR || !process.stdout.isTTY
const c = (code) => (noColor ? '' : code)

// ── Resolve version from package.json ─────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
let VERSION = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'))
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

const WIN_TITLE = 'Hello, Murasaki'
const WIN_SIZE  = { width: 1920, height: 1080 }
const START_AT  = Date.now()
const isDev     = process.env.MURASAKI_DEV === '1'

// ── Banner ────────────────────────────────────────────────────────────
function printBanner() {
  process.stdout.write('\n')
  process.stdout.write(`   ${c(BOLD)}${c(BRIGHT)}🦋 Murasaki${c(RESET)} ${c(DIM)}${VERSION}${c(RESET)}\n\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Window     ${c(RESET)}${WIN_TITLE} ${c(DIM)}(${WIN_SIZE.width}×${WIN_SIZE.height})${c(RESET)}\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Webview    ${c(RESET)}${WEBVIEW_ENGINE}\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Runtime    ${c(RESET)}Node ${process.version}\n`)
  process.stdout.write(`   ${c(DIM)}-${c(RESET)} ${c(DIM)}Mode       ${c(RESET)}${isDev ? 'development ' + c(DIM) + '(file watcher active)' + c(RESET) : 'production'}\n\n`)
}

function printShortcuts() {
  process.stdout.write(`   ${c(DIM)}Shortcuts  ${c(RESET)}${c(BOLD)}o${c(RESET)} ${c(DIM)}open window${c(RESET)}   ${c(BOLD)}r${c(RESET)} ${c(DIM)}restart window${c(RESET)}   ${c(BOLD)}q${c(RESET)} ${c(DIM)}quit${c(RESET)}\n\n`)
}

function printStarting() { process.stdout.write(` ${c(DIM)}○${c(RESET)} Starting...\n`) }
function printReady(ms)  { process.stdout.write(` ${c(GREEN)}${c(BOLD)}✓${c(RESET)} ${c(BOLD)}Ready${c(RESET)} ${c(DIM)}in ${ms}ms${c(RESET)}\n`) }
function printOpened()   { process.stdout.write(` ${c(GREEN)}${c(BOLD)}✓${c(RESET)} Window opened\n`) }
function printClosed()   { process.stdout.write(` ${c(DIM)}○${c(RESET)} Window closed   ${c(DIM)}— press ${c(RESET)}${c(BOLD)}o${c(RESET)}${c(DIM)} to re-open, ${c(RESET)}${c(BOLD)}q${c(RESET)}${c(DIM)} to quit${c(RESET)}\n`) }
function printBye()      { process.stdout.write(`\n ${c(DIM)}Bye 🦋${c(RESET)}\n\n`) }

// ── Page HTML ─────────────────────────────────────────────────────────
const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hello, Murasaki</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        display: grid;
        place-items: center;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        background: linear-gradient(135deg, #faf8ff 0%, #f3eafe 100%);
        text-align: center;
      }
      @media (prefers-color-scheme: dark) {
        body { background: linear-gradient(135deg, #0a0612 0%, #1a0a33 100%); color: #faf8ff; }
      }
      h1 {
        font-size: 72px;
        margin: 0;
        background: linear-gradient(135deg, #5B21B6 0%, #A855F7 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        font-weight: 800;
        letter-spacing: -0.04em;
        text-align: center;
      }
      p { margin-top: 12px; opacity: 0.6; font-size: 16px; text-align: center; }
    </style>
  </head>
  <body>
    <div>
      <h1>Hello, Murasaki 🦋</h1>
      <p>Running in a native OS WebView. No Chromium. No Rust.</p>
    </div>
  </body>
</html>
`

// ── Window lifecycle ──────────────────────────────────────────────────
// EventLoop can't be recreated (winit/tao limitation), so the Application
// is created exactly once. ControlFlow.Wait keeps the loop alive even when
// no windows are open.
const app = new Application({ controlFlow: ControlFlow.Wait })
let win = null

app.onEvent((event) => {
  const kind = event && (event.kind || event.event)
  if (kind === 'window-close-requested') {
    win = null
    printClosed()
  }
})

function openWindow() {
  if (win) {
    printShortcutHint('Window is already open')
    return
  }
  win = app.createBrowserWindow({
    title: WIN_TITLE,
    width: WIN_SIZE.width,
    height: WIN_SIZE.height,
  })
  win.createWebview({ html })
  printOpened()
}

function closeWindow() {
  // OS / wry handles disposal when the window is closed via the close button.
  // For programmatic close (r key), we just dispose and let onEvent clear win.
  if (!win) return
  try { win.dispose() } catch {}
  win = null
}

function printShortcutHint(msg) {
  process.stdout.write(` ${c(DIM)}· ${msg}${c(RESET)}\n`)
}

// ── Keyboard input (stdin raw mode) ────────────────────────────────────
function setupShortcuts() {
  if (!process.stdin.isTTY) return
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (key) => {
    if (key === 'o' || key === 'O') {
      openWindow()
    } else if (key === 'r' || key === 'R') {
      closeWindow()
      openWindow()
    } else if (key === 'q' || key === 'Q' || key === '' /* Ctrl+C */) {
      printBye()
      try { app.exit() } catch {}
      process.exit(0)
    }
  })
}

// ── Boot ──────────────────────────────────────────────────────────────
printBanner()
printShortcuts()
printStarting()
openWindow()
printReady(Date.now() - START_AT)
setupShortcuts()

app.run()  // EventLoop starts once; ControlFlow.Wait keeps it alive after window close
