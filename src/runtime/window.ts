// Owns the Application + multiple BrowserWindow lifecycle.
//
// Windows are tracked in a Map<id, entry>. Each window gets its own native
// bridge so that `useWindow().minimize()` etc. acts on the window the call
// came from, not "the one main window".

import { Application } from '@webviewjs/webview'
import { printBye, printClosed, printError, printHint, printReloaded } from '../cli/log.ts'
import { DEFAULT_WIN_SIZE, DEFAULT_WIN_TITLE, projectRoot } from '../env.ts'
import type { Metadata } from '../index.ts'
import type { WindowConfig } from '../types.ts'
import { teardownHmr } from './hmr.ts'
import { createWindowBridge, nativeBridge } from './native.ts'
import { renderApp } from './render.tsx'
import { teardownStdin } from './shortcuts.ts'

export type OpenWindowOptions = {
  /** Stable id so the same window can be re-opened / found later. Defaults to auto. */
  id?: string
  title?: string
  width?: number
  height?: number
  /** Hash route to load in the new window. Defaults to "/". */
  url?: string
  /** Direct HTML override (ignores url + the app's rendered HTML). */
  html?: string
}

// Default main-window config, possibly overridden by metadata on first render.
const mainConfig: WindowConfig = {
  title: DEFAULT_WIN_TITLE,
  width: DEFAULT_WIN_SIZE.width,
  height: DEFAULT_WIN_SIZE.height,
}

// Default event-loop mode. ControlFlow.Wait was removed because it caused
// the close button to hang waiting for the next pump tick.
export const app = new Application()

type BrowserWindow = ReturnType<typeof app.createBrowserWindow>
type Webview = ReturnType<BrowserWindow['createWebview']>

type WindowEntry = { id: string; win: BrowserWindow; webview: Webview }

const windows = new Map<string, WindowEntry>()
let mainWindowId: string | null = null
let nextAutoId = 0

function genId(): string {
  return `w${++nextAutoId}`
}

// ── Close handlers ────────────────────────────────────────────────────
app.onEvent((event) => {
  const kind = event && ((event as any).kind || (event as any).event)
  if (kind === 'window-close-requested') {
    // We don't know which window from the event payload here — the OS will
    // dispose it. Find any disposed window and drop it from our map.
    // (Best-effort: prune entries whose underlying win signals dispose by
    //  throwing on probe.)
    pruneDisposedWindows()
    printClosed()
    return
  }
  if (kind === 'application-close-requested') {
    teardownHmr()
    teardownStdin()
    printBye()
    try {
      app.exit()
    } catch {}
    process.exit(0)
  }
})

function pruneDisposedWindows() {
  for (const [id, entry] of [...windows.entries()]) {
    // No isAlive API exposed; rely on app dispatching application-close
    // when the last one's gone. We just leave entries here and let the
    // app-close path teardown.
    void id
    void entry
  }
}

function disposeSafely(target: unknown): void {
  if (!target) return
  const sym = (target as { [Symbol.dispose]?: () => void })[Symbol.dispose]
  if (typeof sym === 'function') {
    try {
      sym.call(target)
    } catch {}
  }
}

// ── Metadata → main window config ─────────────────────────────────────
function applyMetadata(metadata?: Metadata) {
  if (!metadata) return
  if (metadata.window?.title) mainConfig.title = metadata.window.title
  else if (metadata.title) mainConfig.title = metadata.title
  if (metadata.window?.width) mainConfig.width = metadata.window.width
  if (metadata.window?.height) mainConfig.height = metadata.window.height
}

export function getConfig(): Readonly<WindowConfig> {
  return mainConfig
}

// ── Public: openWindow (main + extra) ─────────────────────────────────
export async function openWindow(opts: OpenWindowOptions = {}): Promise<string> {
  const id = opts.id ?? genId()
  // Reject duplicates so callers can opt-in to "find or create" by stable id.
  if (windows.has(id)) {
    printHint(`Window "${id}" is already open`)
    return id
  }

  // Determine HTML / config. For the very first (main) window we let the
  // app's metadata drive the size; for subsequent windows callers must
  // specify (or accept the inherited config).
  let html: string
  let metadata: Metadata | undefined
  if (opts.html) {
    html = opts.html
  } else {
    const rendered = await renderApp()
    html = rendered.html
    metadata = rendered.metadata
  }

  if (!mainWindowId) applyMetadata(metadata)

  const config: WindowConfig = {
    title: opts.title ?? mainConfig.title,
    width: opts.width ?? mainConfig.width,
    height: opts.height ?? mainConfig.height,
  }

  const win = app.createBrowserWindow({
    title: config.title,
    width: config.width,
    height: config.height,
  })

  // If a route was requested, fall through to the hash so the in-page
  // navigation script switches to it after load.
  const finalHtml = opts.url ? html.replace(/(<head>)/, `$1<script>location.hash = ${JSON.stringify(opts.url)}</script>`) : html

  const webview = win.createWebview({ html: finalHtml })
  try {
    webview.expose('murasaki', {
      ...nativeBridge,
      ...createWindowBridge(() => win),
      // Window-list operations (same names usable from any window).
      windowList: async () => [...windows.keys()],
      windowOpen: async (o?: OpenWindowOptions) => openWindow(o ?? {}),
      windowCloseById: async (target: string) => closeWindowById(target),
      windowMainId: async () => mainWindowId,
    })
  } catch (e: any) {
    printError(`Native bridge expose failed: ${e.message}`)
  }

  windows.set(id, { id, win, webview })
  if (!mainWindowId) mainWindowId = id
  return id
}

export function closeWindowById(id: string): void {
  const entry = windows.get(id)
  if (!entry) return
  disposeSafely(entry.webview)
  disposeSafely(entry.win)
  windows.delete(id)
}

/** Close the main window (kept for back-compat with the single-window flow). */
export function closeWindow(): void {
  if (mainWindowId) closeWindowById(mainWindowId)
  mainWindowId = null
}

// ── Reload (main window) ──────────────────────────────────────────────
export async function reloadWindow(triggerFile: string): Promise<void> {
  if (!mainWindowId) return
  const entry = windows.get(mainWindowId)
  if (!entry) return
  try {
    const { html } = await renderApp()
    entry.webview.loadHtml(html)
    printReloaded(triggerFile.replace(`${projectRoot}/`, ''))
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
