// Owns the Application + BrowserWindow lifecycle.

import { Application } from '@webviewjs/webview'
import { printBye, printClosed, printError, printHint, printReloaded } from '../cli/log.ts'
import { DEFAULT_WIN_SIZE, DEFAULT_WIN_TITLE, projectRoot } from '../env.ts'
import type { Metadata } from '../index.ts'
import type { WindowConfig } from '../types.ts'
import { teardownHmr } from './hmr.ts'
import { nativeBridge } from './native.ts'
import { renderApp } from './render.tsx'

const config: WindowConfig = {
  title: DEFAULT_WIN_TITLE,
  width: DEFAULT_WIN_SIZE.width,
  height: DEFAULT_WIN_SIZE.height,
}

// Default event-loop mode (pump_events at ~60 FPS). ControlFlow.Wait used to
// be set here to allow `o` re-open after close, but it caused the close
// button to hang waiting for the next pump tick, which macOS interpreted
// as "not responding". Plain run-loop is responsive and just as cheap.
export const app = new Application()

type BrowserWindow = ReturnType<typeof app.createBrowserWindow>
type Webview = ReturnType<BrowserWindow['createWebview']>

let win: BrowserWindow | null = null
let webview: Webview | null = null

// winit/wry distinguishes two close events:
//   - window-close-requested      → one window's red button
//   - application-close-requested → last window closed → app should exit
// We MUST handle the latter and call app.exit(), otherwise the OS sees
// the process as alive but unresponsive (no pending GUI work, no exit).
app.onEvent((event) => {
  const kind = event && ((event as any).kind || (event as any).event)
  if (kind === 'window-close-requested') {
    webview = null
    win = null
    printClosed()
    return
  }
  if (kind === 'application-close-requested') {
    teardownHmr()
    printBye()
    try {
      app.exit()
    } catch {}
    process.exit(0)
  }
})

// Manual close path (the `r` shortcut for restart). We reopen immediately
// after, so explicit dispose is desirable.
function disposeSafely(target: unknown): void {
  if (!target) return
  const sym = (target as { [Symbol.dispose]?: () => void })[Symbol.dispose]
  if (typeof sym === 'function') {
    try {
      sym.call(target)
    } catch {}
  }
}

function applyMetadata(metadata?: Metadata) {
  if (!metadata) return
  if (metadata.window?.title) config.title = metadata.window.title
  else if (metadata.title) config.title = metadata.title
  if (metadata.window?.width) config.width = metadata.window.width
  if (metadata.window?.height) config.height = metadata.window.height
}

export function getConfig(): Readonly<WindowConfig> {
  return config
}

export async function openWindow(): Promise<void> {
  if (win) {
    printHint('Window is already open')
    return
  }
  const { html, metadata } = await renderApp()
  applyMetadata(metadata)
  win = app.createBrowserWindow({
    title: config.title,
    width: config.width,
    height: config.height,
  })
  webview = win.createWebview({ html })
  // Expose native bridge under window.murasaki for client hooks.
  try {
    webview.expose('murasaki', nativeBridge)
  } catch (e: any) {
    printError(`Native bridge expose failed: ${e.message}`)
  }
}

export function closeWindow(): void {
  disposeSafely(webview)
  disposeSafely(win)
  webview = null
  win = null
}

export async function reloadWindow(triggerFile: string): Promise<void> {
  if (!webview) return
  try {
    const { html } = await renderApp()
    webview.loadHtml(html)
    printReloaded(triggerFile.replace(projectRoot + '/', ''))
  } catch (e: any) {
    printError(`Reload failed: ${e.message}`)
  }
}

export function runApp(): void {
  app.run()
}

export function exitApp(): void {
  try {
    app.exit()
  } catch {}
}
