/**
 * Client-side hooks that talk to the Rust native binding through the
 * built-in IPC channel.
 *
 * `installClientRpc()` sets up the postMessage listener. `useGlobalContextMenu()`
 * posts `{ kind: 'contextMenu' }` over IPC and the Rust IPC handler pops the
 * native menu itself (no round-trip to Node — see `crates/native/src/webview.rs`).
 * The clicked item comes back as a `murasaki:menuclick` `CustomEvent` on
 * `window`, dispatched via `evaluate_script` from Rust, not through this
 * module's IPC `message` listener.
 */
import { useEffect } from 'react'

type IpcMsg = { kind: 'ready' }

type Handler = (msg: IpcMsg) => void

const handlers = new Set<Handler>()
let installed = false

export function installClientRpc() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('message', (ev) => {
    const raw = ev.data
    if (!raw || typeof raw !== 'object') return
    for (const h of handlers) h(raw as IpcMsg)
  })

  // Ready ping — the Rust side listens for this before revealing the window.
  post({ kind: 'ready' })
}

export function subscribe(h: Handler): () => void {
  handlers.add(h)
  return () => handlers.delete(h)
}

export function post(msg: unknown) {
  const bridge = (window as any).ipc
  if (bridge && typeof bridge.postMessage === 'function') {
    bridge.postMessage(JSON.stringify(msg))
  }
}

/**
 * Quits the app.
 *
 * Posts `{ kind: 'appQuit' }` over the IPC bridge. Handled synchronously in
 * Rust (see `crates/native/src/webview.rs`'s `QUIT_REQUESTED`), exactly like
 * `contextMenu`/`appMenu` — it never round-trips through Node, since
 * `Application::run()` blocks the libuv loop for as long as the app is open.
 *
 * This is the only way to quit a murasaki app programmatically; there is no
 * other API for it. `useUpdate()`'s `install()` calls this after the backend
 * has staged an update and spawned the detached apply-helper, per the
 * install → quit → apply handshake (updater contract §7) — but it's a
 * general-purpose primitive, not an updater internal.
 */
export function quit() {
  post({ kind: 'appQuit' })
}

export interface ContextMenuItem {
  id?: string
  label?: string
  role?:
    | 'copy'
    | 'cut'
    | 'paste'
    | 'selectAll'
    | 'undo'
    | 'redo'
    | 'about'
    | 'quit'
    | 'close'
    | 'minimize'
    | 'zoom'
    | 'separator'
  accelerator?: string
  enabled?: boolean
  submenu?: ContextMenuItem[]
}

export function useGlobalContextMenu(
  items: ContextMenuItem[] | ((target: EventTarget | null) => ContextMenuItem[]),
  onSelect?: (id: string) => void,
) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault()
      const resolved = typeof items === 'function' ? items(e.target) : items
      post({
        kind: 'contextMenu',
        items: resolved,
        x: e.clientX,
        y: e.clientY,
      })
    }
    const onMenuClick = (e: Event) => {
      onSelect?.((e as CustomEvent<string>).detail)
    }
    document.addEventListener('contextmenu', handler)
    window.addEventListener('murasaki:menuclick', onMenuClick)
    return () => {
      document.removeEventListener('contextmenu', handler)
      window.removeEventListener('murasaki:menuclick', onMenuClick)
    }
  }, [items, onSelect])
}
