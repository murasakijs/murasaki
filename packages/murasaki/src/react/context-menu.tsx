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
 *     { label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> },
 *     { separator: true },
 *     { label: 'Copy', action: <Action.Copy /> },
 *   ])
 *
 *   // Scoped — name the menu, then tag a region with a matching trigger:
 *   useContextMenu('card', [
 *     { label: 'Increment', action: () => setCount((n) => n + 1) },
 *   ])
 *   // …in the return: <ContextMenuTrigger id="card"><Card /></ContextMenuTrigger>
 *
 * Each item's `action` is either a built-in `<Action.* />` element (a native
 * role, or a client behaviour like Reload/Navigate) or your own function. A
 * scoped right-click `preventDefault`s (so the window default, gated on
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
// Item spec — the data you hand to useContextMenu. `action` is a built-in
// `<Action.* />` element or a function; `items` makes a submenu; `{ separator:
// true }` draws a divider.
// ---------------------------------------------------------------------------

export type ContextMenuRole = 'copy' | 'paste' | 'cut' | 'selectAll' | 'undo' | 'redo' | 'quit'

/** What an item does: a built-in `<Action.* />` element, or your own function. */
export type ContextMenuAction = ReactElement | (() => void | Promise<void>)

export interface ContextMenuEntry {
  label: string
  shortcut?: string
  disabled?: boolean
  /** A built-in `<Action.Copy />` / `<Action.Reload />` / … element, or a custom function. */
  action?: ContextMenuAction
  /** A nested submenu (in place of an action). */
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
// Action.* — the value you put in an item's `action`. Each is a marker element
// (renders nothing) carrying a static descriptor: a native `role` the OS
// performs itself, or a `__client` behaviour run on this side. For anything
// custom, pass a plain function as `action` instead.
// ---------------------------------------------------------------------------

function roleAction(name: string, role: ContextMenuRole) {
  function ActionComponent() {
    return null
  }
  ActionComponent.displayName = `Action.${name}`
  ;(ActionComponent as any).__role = role
  return ActionComponent
}

const Copy = roleAction('Copy', 'copy')
const Paste = roleAction('Paste', 'paste')
const Cut = roleAction('Cut', 'cut')
const SelectAll = roleAction('SelectAll', 'selectAll')
const Undo = roleAction('Undo', 'undo')
const Redo = roleAction('Redo', 'redo')
const Quit = roleAction('Quit', 'quit')

function Reload() {
  return null
}
Reload.displayName = 'Action.Reload'
;(Reload as any).__client = 'reload'

export interface ActionNavigateProps {
  to: string
}

function Navigate(_props: ActionNavigateProps) {
  return null
}
Navigate.displayName = 'Action.Navigate'
;(Navigate as any).__client = 'navigate'

export interface ActionRunProps {
  action: () => void | Promise<void>
}

/** A custom action in component form — the same as passing a bare function. */
function Run(_props: ActionRunProps) {
  return null
}
Run.displayName = 'Action.Run'
;(Run as any).__client = 'run'

export const Action = {
  Copy,
  Paste,
  Cut,
  SelectAll,
  Undo,
  Redo,
  Quit,
  Reload,
  Navigate,
  Run,
}

/**
 * Turn a map of named functions into `<Action.* />` components you can drop
 * straight into a menu item's `action`, alongside the built-ins. Define your
 * app's actions once (typically in `src/lib/action.ts`, backed by a store so
 * they're callable from anywhere) and reuse them across menus without a
 * per-call-site wrapper:
 *
 *   // src/lib/action.ts
 *   export const Action = createActions({
 *     increment: () => useCounter.getState().increment(),
 *   })
 *   // …then: { label: 'Increment', action: <Action.increment /> }
 *
 * The returned object also includes the built-in `Action.Copy` / `Action.Reload`
 * / … so a file can import a single `Action`.
 */
export function createActions<T extends Record<string, () => void | Promise<void>>>(
  defs: T,
): typeof Action & { [K in keyof T]: () => null } {
  const custom: Record<string, () => null> = {}
  for (const name of Object.keys(defs)) {
    const ActionComponent = () => null
    ActionComponent.displayName = `Action.${name}`
    ;(ActionComponent as any).__client = 'run'
    ;(ActionComponent as any).__run = defs[name]
    custom[name] = ActionComponent
  }
  return { ...Action, ...custom } as typeof Action & { [K in keyof T]: () => null }
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

  function resolveAction(action: ContextMenuAction | undefined, id: string, wire: WireMenuItem) {
    if (!action) return
    if (typeof action === 'function') {
      handlers.set(id, action)
      return
    }
    if (isValidElement(action)) {
      const type = action.type as any
      if (type?.__role) {
        wire.role = type.__role
      } else if (type?.__client === 'reload') {
        handlers.set(id, () => window.location.reload())
      } else if (type?.__client === 'navigate') {
        const to = (action.props as ActionNavigateProps).to
        handlers.set(id, () => router.push(to))
      } else if (type?.__client === 'run') {
        // `<Action.Run action={fn} />` carries the fn as a prop; a `createActions`
        // component carries it statically on the type as `__run`.
        const fn = (type.__run as (() => void | Promise<void>) | undefined) ?? (action.props as ActionRunProps).action
        if (fn) handlers.set(id, fn)
      }
    }
  }

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
      } else {
        resolveAction(entry.action, id, wire)
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
