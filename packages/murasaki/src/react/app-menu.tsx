/**
 * Declarative native **app menu bar** — mirrors `useContextMenu`, but for the
 * top-of-window menu bar (NSMenu on macOS, HMENU on Windows) instead of a
 * right-click popup. Call once, e.g. in the root layout:
 *
 *   useAppMenu([
 *     { label: 'File', items: [
 *       { label: 'New Window', shortcut: 'command,N', action: () => {...} },
 *       { separator: true },
 *       { role: 'close' },              // standard Close Window (⌘W / Ctrl+W)
 *     ]},
 *     { role: 'editMenu' },             // standard Edit submenu
 *     { label: 'View', items: [
 *       { label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> },
 *     ]},
 *   ])
 *
 * Declaring a menu here REPLACES the framework's startup default menu bar
 * (the plain one macOS/Windows install automatically otherwise) — see
 * `crates/native/src/webview.rs`'s `{ kind: "appMenu" }` IPC branch. Apps
 * that never call this hook keep that default menu unchanged.
 *
 * A `{ role }` item uses a standard, natively-localized label and behavior
 * (Undo/Redo/Cut/Copy/Paste/Select All/Minimize/Zoom/Close/Quit) — no
 * `action` needed, and on macOS these ride the OS's real responder chain /
 * window-manager behavior, no JS involved at all. `{ role: 'reload' }` is the
 * one exception: there's no native "reload a webview" concept, so it's sugar
 * for `action: <Action.Reload />` under the hood — handled in JS on both
 * platforms, for consistency.
 *
 * Shortcuts: `parseShortcut` turns e.g. `'command,N'` into both a muda
 * accelerator (a REAL, OS-handled key equivalent on macOS — pressing it never
 * even reaches this page's `keydown`) and a `matches(e)` predicate fired
 * straight off `keydown` here, same as `useContextMenu`. That second path is
 * what makes shortcuts work on Windows too, where a native menu's accelerator
 * text is decorative only (muda/Win32 need extra `TranslateAcceleratorW`
 * wiring murasaki doesn't do) — see `crates/native/src/menu.rs`'s
 * `build_windows_menu_bar` doc comment. On macOS, a key equivalent that a
 * menu owns is intercepted by Cocoa before it ever reaches the webview's
 * `keydown`, so this second path is naturally a no-op there — no
 * double-firing.
 */
import { isValidElement, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { post } from './rpc.js'
import type { ContextMenuItem as WireMenuItem } from './rpc.js'
import { appWindow } from '../native/index.js'
import { useRouter } from './router.js'
import { parseShortcut } from './shortcut.js'

// ---------------------------------------------------------------------------
// Item spec — the data you hand to useAppMenu.
// ---------------------------------------------------------------------------

/**
 * Standard, natively-handled roles. All but `'reload'` map straight onto a
 * muda `PredefinedMenuItem` on macOS (no JS involved) or a native
 * window/process action on Windows — see `crates/native/src/menu.rs`'s
 * `predefined_localized` / `windows_role_item`. `'reload'` has no native
 * counterpart, so it's JS sugar for `action: <Action.Reload />` instead (see
 * the module doc comment).
 */
export type AppMenuItemRole =
  | 'quit'
  | 'close'
  | 'minimize'
  | 'zoom'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'reload'

/** A built-in `<Action.Reload />` / `<Action.Navigate />` / `<Action.Run />` element, or your own function. */
export type AppMenuAction = ReactElement | (() => void | Promise<void>)

export interface AppMenuEntry {
  label: string
  shortcut?: string
  disabled?: boolean
  /** A custom function, or one of the client-behaviour `<Action.* />` elements (`Reload`/`Navigate`/`Run`). */
  action?: AppMenuAction
  /** A nested submenu (in place of an action). */
  items?: AppMenuItemSpec[]
}

export type AppMenuItemSpec = AppMenuEntry | { role: AppMenuItemRole } | { separator: true }

/** Standard submenu roles for a top-level `AppMenu` entry. */
export type AppMenuRole = 'editMenu' | 'windowMenu'

/** One top-level menu (e.g. "File") — a custom submenu, or a standard role submenu. */
export type AppMenu = { label: string; items: AppMenuItemSpec[] } | { role: AppMenuRole }

// ---------------------------------------------------------------------------
// Wire shape sent to Rust (`{ kind: "appMenu", menus }`) — items reuse
// `ContextMenuItem` (aliased `WireMenuItem`), the same wire shape the
// context-menu popup already uses.
// ---------------------------------------------------------------------------

interface WireAppMenu {
  role?: AppMenuRole
  label?: string
  items?: WireMenuItem[]
}

interface Parsed {
  menus: WireAppMenu[]
  handlers: Map<string, () => void>
  shortcuts: { matches: (e: KeyboardEvent) => boolean; run: () => void }[]
}

type MenuRef = { current: Parsed }

// ---------------------------------------------------------------------------
// Single active app menu — unlike `useContextMenu`'s scoped popups, there's
// only ever one app-wide menu bar, so this mirrors just the "window-default"
// half of that module (see `context-menu.tsx`'s `windowMenu`).
// ---------------------------------------------------------------------------

let currentAppMenu: MenuRef | null = null

function onMenuClick(e: Event) {
  const id = (e as CustomEvent<string>).detail
  currentAppMenu?.current.handlers.get(id)?.()
}

function onKeyDown(e: KeyboardEvent) {
  // Ignore keys fired while an IME composition is active — see
  // `context-menu.tsx`'s identical guard for why.
  if (e.isComposing || e.keyCode === 229) return
  if (!currentAppMenu) return
  for (const shortcut of currentAppMenu.current.shortcuts) {
    if (shortcut.matches(e)) {
      e.preventDefault()
      shortcut.run()
      return
    }
  }
}

let listenerRefs = 0
let appMenuInstanceCounter = 0
function retainGlobalListeners() {
  if (listenerRefs++ === 0) {
    window.addEventListener('murasaki:menuclick', onMenuClick)
    window.addEventListener('keydown', onKeyDown)
  }
}
function releaseGlobalListeners() {
  if (--listenerRefs === 0) {
    window.removeEventListener('murasaki:menuclick', onMenuClick)
    window.removeEventListener('keydown', onKeyDown)
  }
}

// ---------------------------------------------------------------------------
// useAppMenu — declare the app's menu bar. Replaces the framework's startup
// default menu the first time it posts (see the module doc comment).
// ---------------------------------------------------------------------------

export function useAppMenu(menus: AppMenu[]): void {
  const router = useRouter()
  const instanceRef = useRef<number | null>(null)
  if (instanceRef.current === null) instanceRef.current = appMenuInstanceCounter++
  const generationRef = useRef({ shape: '', value: 0 })

  // Rebuilt every render (menus is a fresh array and its actions close over
  // the latest state); the ref keeps the once-installed listeners seeing it.
  const parsedRef = useRef<Parsed>({ menus: [], handlers: new Map(), shortcuts: [] })
  const shapeCandidate = buildAppMenu(menus, router, 'murasaki-app-menu-shape')
  const shape = JSON.stringify(shapeCandidate.menus, (key, value) => key === 'id' ? undefined : value)
  if (generationRef.current.shape !== shape) {
    generationRef.current = {
      shape,
      value: generationRef.current.value + 1,
    }
  }
  parsedRef.current = buildAppMenu(
    menus,
    router,
    `murasaki-app-menu-${instanceRef.current}-${generationRef.current.value}`,
  )

  useEffect(() => {
    retainGlobalListeners()
    const prev = currentAppMenu
    currentAppMenu = parsedRef
    if (prev && prev !== parsedRef && process.env.NODE_ENV !== 'production') {
      console.warn('[murasaki] more than one useAppMenu() is mounted — the last one wins.')
    }
    return () => {
      if (currentAppMenu === parsedRef) currentAppMenu = null
      releaseGlobalListeners()
    }
  }, [])

  // Install/replace the native menu whenever its WIRE shape actually changes
  // — not on every render, since actions/enabled-state closures already stay
  // fresh via the ref above without needing a native round-trip. Functions
  // never appear in the wire shape (they live in `handlers` instead), so
  // this JSON signature is a safe, cheap way to detect a real structural
  // change (new/renamed/reordered items, a flipped `enabled`, …).
  const wireSignature = JSON.stringify(parsedRef.current.menus)
  useEffect(() => {
    post({ kind: 'appMenu', menus: parsedRef.current.menus })
    // `wireSignature` (not `parsedRef`) is the intended dependency — see the
    // comment above.
  }, [wireSignature])
}

// ---------------------------------------------------------------------------
// Builder — turns the item specs into the wire shape the native side expects,
// plus the client-side handler and keydown-shortcut maps. Mirrors
// `context-menu.tsx`'s `buildMenu`, one level deeper (top-level menus, each
// with their own items) and with `role` expressed as its own item-spec
// variant instead of an `<Action.* />` element.
// ---------------------------------------------------------------------------

function buildAppMenu(
  menus: AppMenu[],
  router: { push(to: string): void },
  idPrefix: string,
): Parsed {
  let counter = 0
  const nextId = () => `${idPrefix}-${counter++}`
  const handlers = new Map<string, () => void>()
  const shortcuts: { matches: (e: KeyboardEvent) => boolean; run: () => void }[] = []

  function resolveAction(action: AppMenuAction | undefined, id: string) {
    if (!action) return
    if (typeof action === 'function') {
      handlers.set(id, action)
      return
    }
    if (isValidElement(action)) {
      const type = action.type as any
      if (type?.__client === 'reload') {
        handlers.set(id, () => window.location.reload())
      } else if (type?.__client === 'navigate') {
        const to = (action.props as { to: string }).to
        handlers.set(id, () => router.push(to))
      } else if (type?.__client === 'run') {
        // `<Action.Run action={fn} />` carries the fn as a prop; a
        // `createActions` component carries it statically on the type as `__run`.
        const fn = (type.__run as (() => void | Promise<void>) | undefined) ?? (action.props as { action: () => void }).action
        if (fn) handlers.set(id, fn)
      }
    }
  }

  function buildItems(specs: AppMenuItemSpec[]): WireMenuItem[] {
    const out: WireMenuItem[] = []
    for (const spec of specs) {
      if (!spec) continue

      if ('separator' in spec && spec.separator) {
        out.push({ id: nextId(), role: 'separator' })
        continue
      }

      if ('role' in spec && spec.role) {
        const id = nextId()
        if (spec.role === 'reload') {
          // No native "reload" concept — sugar for a plain custom action.
          handlers.set(id, () => window.location.reload())
          out.push({ id, label: 'Reload' })
        } else {
          // Native side ignores `label`/`id` for a role item (uses its own
          // localized text + fixed id) — sent anyway for wire-shape uniformity.
          out.push({ id, role: spec.role as WireMenuItem['role'] })
          if (spec.role === 'close') {
            const { matches } = parseShortcut('command,W')
            shortcuts.push({ matches, run: () => { void appWindow.close() } })
          }
        }
        continue
      }

      const entry = spec as AppMenuEntry
      const id = nextId()
      const wire: WireMenuItem = { id, label: entry.label, enabled: !entry.disabled }

      if (entry.items) {
        wire.submenu = buildItems(entry.items)
      } else {
        resolveAction(entry.action, id)
      }

      if (entry.shortcut) {
        try {
          const { accelerator, matches } = parseShortcut(entry.shortcut)
          wire.accelerator = accelerator
          const handler = handlers.get(id)
          if (handler) shortcuts.push({ matches, run: handler })
        } catch (error) {
          // A malformed spec must not take down the whole menu — the item
          // stays clickable, only the accelerator is dropped.
          console.error('[murasaki] app menu:', error)
        }
      }

      out.push(wire)
    }
    return out
  }

  const wireMenus: WireAppMenu[] = menus.map((m) => {
    if ('role' in m) return { role: m.role }
    return { label: m.label, items: buildItems(m.items) }
  })

  return { menus: wireMenus, handlers, shortcuts }
}
