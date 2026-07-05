/**
 * Native context menus, declared with a hook instead of markup — so the menu
 * lives next to your state (its `action`s can close over `useState` setters),
 * separate from what you return. None of it renders HTML: items are posted to
 * the Rust side, which pops the real OS menu (see `./rpc.ts`). Clicks come back
 * as a `murasaki:menuclick` `CustomEvent` on `window`; shortcuts additionally
 * fire straight off `keydown` so they work without opening the menu.
 *
 *   // App-wide — no id → the whole-window default (right-click anywhere):
 *   useContextMenu([
 *     { label: 'Reload', shortcut: 'command,R', action: () => location.reload() },
 *     { separator: true },
 *     { label: 'Copy', role: 'copy' },
 *   ])
 *
 *   // Scoped — name the menu, then tag a region with a matching trigger:
 *   useContextMenu('card', [
 *     { label: 'Increment', action: () => setCount((n) => n + 1) },
 *   ])
 *   // …in the return: <ContextMenuTrigger id="card"><Card /></ContextMenuTrigger>
 *
 * A scoped right-click `preventDefault`s (so the window default, gated on
 * `defaultPrevented`, stays quiet) and `stopPropagation`s (so a nested trigger
 * wins over an outer one).
 */
import { Children, cloneElement, isValidElement, useEffect, useId, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { post } from './rpc.js'
import type { ContextMenuItem as WireMenuItem } from './rpc.js'
import { useRouter } from './router.js'
import { parseShortcut } from './shortcut.js'

// ---------------------------------------------------------------------------
// Item spec — the data you hand to useContextMenu. Exactly one behaviour per
// item: a native `role`, a client `action`, a `navigate` target, or `items`
// for a submenu. `{ separator: true }` draws a divider.
// ---------------------------------------------------------------------------

export type ContextMenuRole = 'copy' | 'paste' | 'cut' | 'selectAll' | 'undo' | 'redo' | 'quit'

export interface ContextMenuEntry {
  label: string
  shortcut?: string
  disabled?: boolean
  /** A native menu role, performed by the OS itself. */
  role?: ContextMenuRole
  /** A custom handler run on this side — may close over component state. */
  action?: () => void | Promise<void>
  /** Navigate to a route (via murasaki's router). */
  navigate?: string
  /** Nested submenu. */
  items?: ContextMenuItemSpec[]
}

export type ContextMenuItemSpec = ContextMenuEntry | { separator: true }

interface Parsed {
  items: WireMenuItem[]
  handlers: Map<string, () => void>
  shortcuts: { matches: (e: KeyboardEvent) => boolean; run: () => void }[]
}

type MenuRef = { current: Parsed }

// ---------------------------------------------------------------------------
// Registry — a `<ContextMenuTrigger id>` and its `useContextMenu(id, …)` are
// declared apart, so they're linked through this module-level registry. Entries
// hold a *ref* (updated every render) so lookups always see the latest closures.
// ---------------------------------------------------------------------------

const scopedMenus = new Map<string, MenuRef>()
let windowMenu: MenuRef | null = null

function openNative(items: WireMenuItem[], x: number, y: number) {
  post({ kind: 'contextMenu', items, x, y })
}

function onMenuClick(e: Event) {
  const id = (e as CustomEvent<string>).detail
  // Item ids are useId-namespaced (unique per menu), so a linear search across
  // the window default + every scoped menu resolves to exactly one handler.
  const handler = windowMenu?.current.handlers.get(id) ?? findScopedHandler(id)
  handler?.()
}

function findScopedHandler(id: string): (() => void) | undefined {
  for (const ref of scopedMenus.values()) {
    const handler = ref.current.handlers.get(id)
    if (handler) return handler
  }
  return undefined
}

function onKeyDown(e: KeyboardEvent) {
  // Ignore keys fired while an IME composition is active. WKWebView (and other
  // engines) emit keydown with `keyCode === 229` / `key === "Process"`
  // mid-composition, so without this a shortcut would misfire on, e.g., the
  // Enter that confirms Japanese/Chinese/Korean input.
  if (e.isComposing || e.keyCode === 229) return
  const menus: Parsed[] = []
  if (windowMenu) menus.push(windowMenu.current)
  for (const ref of scopedMenus.values()) menus.push(ref.current)
  for (const menu of menus) {
    for (const shortcut of menu.shortcuts) {
      if (shortcut.matches(e)) {
        e.preventDefault()
        shortcut.run()
        return
      }
    }
  }
}

function onWindowContextMenu(e: MouseEvent) {
  // A scoped trigger handles its region by calling preventDefault (which sets
  // defaultPrevented on this same native event, since a trigger's React handler
  // runs before the event bubbles up to window) — so the window default only
  // fires where nothing more specific claimed the click.
  if (e.defaultPrevented || !windowMenu) return
  e.preventDefault()
  openNative(windowMenu.current.items, e.clientX, e.clientY)
}

let listenerRefs = 0
function retainGlobalListeners() {
  if (listenerRefs++ === 0) {
    window.addEventListener('murasaki:menuclick', onMenuClick)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('contextmenu', onWindowContextMenu)
  }
}
function releaseGlobalListeners() {
  if (--listenerRefs === 0) {
    window.removeEventListener('murasaki:menuclick', onMenuClick)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('contextmenu', onWindowContextMenu)
  }
}

// ---------------------------------------------------------------------------
// useContextMenu — declare a menu. `useContextMenu(items)` is the whole-window
// default; `useContextMenu(id, items)` is scoped to <ContextMenuTrigger id={id}>.
// ---------------------------------------------------------------------------

export function useContextMenu(items: ContextMenuItemSpec[]): void
export function useContextMenu(id: string, items: ContextMenuItemSpec[]): void
export function useContextMenu(
  idOrItems: string | ContextMenuItemSpec[],
  maybeItems?: ContextMenuItemSpec[],
): void {
  const scopeId = typeof idOrItems === 'string' ? idOrItems : undefined
  const specs = (typeof idOrItems === 'string' ? maybeItems : idOrItems) ?? []

  const router = useRouter()
  // Namespaces this menu's item ids so a click resolves in the menu that owns
  // it, even though every menu shares one window-wide `murasaki:menuclick`.
  const uid = useId()

  // Rebuilt every render (specs is a fresh array and its actions close over the
  // latest state); the ref keeps the once-installed listeners seeing it.
  const parsedRef = useRef<Parsed>({ items: [], handlers: new Map(), shortcuts: [] })
  parsedRef.current = buildMenu(specs, router, uid)

  useEffect(() => {
    retainGlobalListeners()
    if (scopeId == null) {
      const prev = windowMenu
      windowMenu = parsedRef
      if (prev && prev !== parsedRef && process.env.NODE_ENV !== 'production') {
        console.warn('[murasaki] more than one window-default useContextMenu() is mounted — the last one wins.')
      }
      return () => {
        if (windowMenu === parsedRef) windowMenu = null
        releaseGlobalListeners()
      }
    }
    scopedMenus.set(scopeId, parsedRef)
    return () => {
      if (scopedMenus.get(scopeId) === parsedRef) scopedMenus.delete(scopeId)
      releaseGlobalListeners()
    }
  }, [scopeId])
}

// ---------------------------------------------------------------------------
// <ContextMenuTrigger id> — tags a region. On right-click it opens the menu
// declared under the same id (a useContextMenu(id, …)), if any.
// ---------------------------------------------------------------------------

export interface ContextMenuTriggerProps {
  /** Links this region to the `useContextMenu(id, …)` of the same name. */
  id: string
  /**
   * Attach the handler to the child element directly (no wrapper node). Defaults
   * to `true` when there's a single element child, `false` otherwise (then a
   * `display: contents` `<span>` carries the handler). Set it explicitly to
   * override.
   */
  asChild?: boolean
  children?: ReactNode
}

export function ContextMenuTrigger({ id, asChild, children }: ContextMenuTriggerProps) {
  const onContextMenu = (e: {
    preventDefault(): void
    stopPropagation(): void
    clientX: number
    clientY: number
  }) => {
    const menu = scopedMenus.get(id)
    // No menu registered for this id: leave the event alone so it bubbles to the
    // window-default handler instead of swallowing the right-click.
    if (!menu) return
    e.preventDefault()
    // Innermost menu wins: stop the event before it reaches an enclosing
    // trigger, so a nested scoped menu overrides an outer one in its region.
    e.stopPropagation()
    openNative(menu.current.items, e.clientX, e.clientY)
  }

  // Default to cloning the child when it's a lone element (the common case — no
  // extra DOM node), and fall back to a wrapper otherwise. `asChild` overrides.
  const kids = Children.toArray(children)
  const sole = kids.length === 1 && isValidElement(kids[0]) ? (kids[0] as ReactElement) : null
  const clone = asChild === true || (asChild === undefined && sole !== null)

  if (clone) {
    const child = (sole ?? Children.only(children)) as ReactElement<{ onContextMenu?: (e: any) => void }>
    return cloneElement(child, {
      onContextMenu: (e: any) => {
        child.props.onContextMenu?.(e)
        onContextMenu(e)
      },
    })
  }

  return (
    <span style={{ display: 'contents' }} onContextMenu={onContextMenu}>
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Builder — turns the item specs into the wire shape the native side expects,
// plus the client-side handler and keydown-shortcut maps.
// ---------------------------------------------------------------------------

function buildMenu(specs: ContextMenuItemSpec[], router: { push(to: string): void }, uid: string): Parsed {
  let counter = 0
  const nextId = () => `${uid}m${counter++}`
  const handlers = new Map<string, () => void>()
  const shortcuts: { matches: (e: KeyboardEvent) => boolean; run: () => void }[] = []

  function build(list: ContextMenuItemSpec[]): WireMenuItem[] {
    const out: WireMenuItem[] = []
    for (const spec of list) {
      if (!spec) continue
      if ('separator' in spec && spec.separator) {
        out.push({ id: nextId(), role: 'separator' })
        continue
      }
      const entry = spec as ContextMenuEntry
      const id = nextId()
      const wire: WireMenuItem = { id, label: entry.label, enabled: !entry.disabled }

      if (entry.items) {
        wire.submenu = build(entry.items)
      } else if (entry.role) {
        wire.role = entry.role
      } else if (entry.action) {
        handlers.set(id, entry.action)
      } else if (entry.navigate != null) {
        const to = entry.navigate
        handlers.set(id, () => router.push(to))
      }

      if (entry.shortcut) {
        const { accelerator, matches } = parseShortcut(entry.shortcut)
        wire.accelerator = accelerator
        const handler = handlers.get(id)
        if (handler) shortcuts.push({ matches, run: handler })
      }

      out.push(wire)
    }
    return out
  }

  return { items: build(specs), handlers, shortcuts }
}
