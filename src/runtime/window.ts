// Owns the Application + BrowserWindow lifecycle.
//
// The EventLoop is created exactly once (winit/tao limitation). ControlFlow.Wait
// keeps the loop alive even when no windows are open, so the user can press
// `o` in the terminal to re-open the window.

import { Application, ControlFlow } from '@webviewjs/webview'
import { printClosed, printError, printHint, printReloaded } from '../cli/log.ts'
import { DEFAULT_WIN_SIZE, DEFAULT_WIN_TITLE, projectRoot } from '../env.ts'
import type { Metadata } from '../index.ts'
import type { WindowConfig } from '../types.ts'
import { nativeBridge } from './native.ts'
import { renderApp } from './render.tsx'

const config: WindowConfig = {
  title: DEFAULT_WIN_TITLE,
  width: DEFAULT_WIN_SIZE.width,
  height: DEFAULT_WIN_SIZE.height,
}

export const app = new Application({ controlFlow: ControlFlow.Wait })

type BrowserWindow = ReturnType<typeof app.createBrowserWindow>
type Webview = ReturnType<BrowserWindow['createWebview']>

let win: BrowserWindow | null = null
let webview: Webview | null = null

// @webviewjs/webview uses TC39 explicit-resource-management semantics:
// the only "dispose" entry point is the [Symbol.dispose] method, not
// a plain .dispose(). Calling win.dispose() does nothing (no such method),
// which is why the close button hangs once exposed IPC handlers hold the
// window alive.
function disposeSafely(target: unknown): void {
  if (!target) return
  const sym = (target as { [Symbol.dispose]?: () => void })[Symbol.dispose]
  if (typeof sym === 'function') {
    try {
      sym.call(target)
    } catch {}
  }
}

app.onEvent((event) => {
  const kind = event && ((event as any).kind || (event as any).event)
  if (kind === 'window-close-requested') {
    // Webview first (drops exposed namespaces + in-flight IPC), then window.
    disposeSafely(webview)
    disposeSafely(win)
    webview = null
    win = null
    printClosed()
  }
})

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
