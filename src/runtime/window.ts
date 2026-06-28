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

// @webviewjs/webview is built on winit. The `window-close-requested` event
// fires when the user clicks the OS close button, and winit completes the
// close automatically on the next pump_events tick UNLESS we interfere.
//
// Earlier versions called win.dispose() / webview.dispose() in this handler,
// thinking that was required. It isn't — and once webview.expose() registered
// native-bridge handlers, calling dispose synchronously from inside the
// event tick wedged the window into an "not responding" state.
//
// The right move: let winit handle the close itself, and just drop our
// JS-side references so subsequent reload/openWindow doesn't see stale state.
app.onEvent((event) => {
  const kind = event && ((event as any).kind || (event as any).event)
  if (kind === 'window-close-requested') {
    webview = null
    win = null
    printClosed()
  }
})

// Manual close (e.g. the `r` shortcut for restart). We DO want explicit
// disposal here because we'll reopen a fresh window immediately afterward.
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
