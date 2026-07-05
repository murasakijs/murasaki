/**
 * Declarative `ContextMenu` that renders as a **native OS menu**, not an HTML
 * popup. You write the menu with `<ContextMenuItem>` + `<Action.*>` children;
 * none of those actually render — they're parsed into the wire shape the native
 * side pops (see `./rpc.ts`). Clicks come back as a `murasaki:menuclick`
 * `CustomEvent` on `window`; shortcuts additionally fire straight off `keydown`
 * so they work without ever opening the menu.
 *
 * Two ways to attach a menu:
 *
 *   // App-wide — a bare <ContextMenu> (no `for`) is the whole-window default:
 *   <ContextMenu>
 *     <ContextMenuItem label="Reload" shortcut="command,R"><Action.Reload /></ContextMenuItem>
 *   </ContextMenu>
 *
 *   // Scoped — tag a region with a trigger id, define the menu with `for`:
 *   <ContextMenuTrigger id="card"><Card /></ContextMenuTrigger>
 *   <ContextMenu for="card">
 *     <ContextMenuItem label="Do it"><Action.Run action={fn} /></ContextMenuItem>
 *   </ContextMenu>
 *
 * A scoped right-click `preventDefault`s (so the window-default, gated on
 * `defaultPrevented`, stays quiet) and `stopPropagation`s (so a nested trigger
 * wins over an outer one). Everything but `ContextMenu`/`ContextMenuTrigger` is
 * a marker component (renders `null`) that the parser matches by a `__murasaki`
 * tag stamped on the function — this survives minification.
 */
import { Children, cloneElement, isValidElement, useEffect, useId, useMemo, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { post } from './rpc.js'
import type { ContextMenuItem as WireMenuItem } from './rpc.js'
import { useRouter } from './router.js'
import { parseShortcut } from './shortcut.js'

interface ParseCtx {
  handlers: Map<string, () => void>
  shortcuts: { matches: (e: KeyboardEvent) => boolean; run: () => void }[]
  router: { push(to: string): void }
  nextId: () => string
}

interface Parsed {
  items: WireMenuItem[]
  handlers: Map<string, () => void>
  shortcuts: { matches: (e: KeyboardEvent) => boolean; run: () => void }[]
}

type MenuRef = { current: Parsed }

// ---------------------------------------------------------------------------
// Registry — a `<ContextMenuTrigger id>` and its `<ContextMenu for>` are
// siblings, not parent/child, so they're linked through this module-level
// registry instead of React context. Entries hold a *ref* (updated every
// render) so lookups always see the latest closures without re-registering.
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
  // defaultPrevented on this same native event, since a nested trigger's React
  // handler runs before the event bubbles up to window) — so the window default
  // only fires where nothing more specific claimed the click.
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
// <ContextMenu> — a menu declaration. Renders nothing. Bare = the whole-window
// default; `for="id"` scopes it to the matching <ContextMenuTrigger id="id">.
// ---------------------------------------------------------------------------

export interface ContextMenuProps {
  /** Scope this menu to the `<ContextMenuTrigger id>` of the same name. Omit for the whole-window default. */
  for?: string
  children?: ReactNode
}

export function ContextMenu({ for: scopeId, children }: ContextMenuProps) {
  const router = useRouter()
  // Namespaces this menu's item ids so a click resolves in the menu that owns
  // it, even though every menu shares one window-wide `murasaki:menuclick`.
  const uid = useId()

  const parsed = useMemo<Parsed>(() => {
    let counter = 0
    const ctx: ParseCtx = {
      handlers: new Map(),
      shortcuts: [],
      router,
      nextId: () => `${uid}m${counter++}`,
    }
    const items = parseContent(children, ctx)
    return { items, handlers: ctx.handlers, shortcuts: ctx.shortcuts }
  }, [children, router, uid])

  const parsedRef = useRef(parsed)
  parsedRef.current = parsed

  useEffect(() => {
    retainGlobalListeners()
    if (scopeId == null) {
      const prev = windowMenu
      windowMenu = parsedRef
      if (prev && prev !== parsedRef && process.env.NODE_ENV !== 'production') {
        console.warn('[murasaki] more than one window-default <ContextMenu> is mounted — the last one wins.')
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

  return null
}
;(ContextMenu as any).__murasaki = 'menu'

// ---------------------------------------------------------------------------
// <ContextMenuTrigger id> — tags a region. On right-click it opens the menu
// registered under the same id (a <ContextMenu for={id}>), if any.
// ---------------------------------------------------------------------------

export interface ContextMenuTriggerProps {
  /** Links this region to the `<ContextMenu for>` of the same name. */
  id: string
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

  if (asChild) {
    const child = Children.only(children) as ReactElement<{ onContextMenu?: (e: any) => void }>
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
// Marker components — none of these render anything; the parser reads their
// props off the element tree instead.
// ---------------------------------------------------------------------------

export interface ContextMenuItemProps {
  label: string
  shortcut?: string
  disabled?: boolean
  children?: ReactNode
}

export function ContextMenuItem(_props: ContextMenuItemProps) {
  return null
}
;(ContextMenuItem as any).__murasaki = 'item'

export function ContextMenuSeparator() {
  return null
}
;(ContextMenuSeparator as any).__murasaki = 'separator'

export interface ContextMenuSubProps {
  label: string
  children?: ReactNode
}

export function ContextMenuSub(_props: ContextMenuSubProps) {
  return null
}
;(ContextMenuSub as any).__murasaki = 'sub'

// ---------------------------------------------------------------------------
// Action.* — each is a marker carrying a static descriptor (a role for the
// native menu to perform itself, or a `__client` tag the parser turns into a
// handler function run from this side).
// ---------------------------------------------------------------------------

function roleAction(name: string, role: NonNullable<WireMenuItem['role']>) {
  function ActionComponent() {
    return null
  }
  ActionComponent.displayName = `Action.${name}`
  ;(ActionComponent as any).__murasaki = 'action'
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
;(Reload as any).__murasaki = 'action'
;(Reload as any).__client = 'reload'

export interface ActionNavigateProps {
  to: string
}

function Navigate(_props: ActionNavigateProps) {
  return null
}
Navigate.displayName = 'Action.Navigate'
;(Navigate as any).__murasaki = 'action'
;(Navigate as any).__client = 'navigate'

export interface ActionRunProps {
  action: () => void | Promise<void>
}

function Run(_props: ActionRunProps) {
  return null
}
Run.displayName = 'Action.Run'
;(Run as any).__murasaki = 'action'
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

// ---------------------------------------------------------------------------
// Parser — walks a menu's children (order-preserving; supports conditionals /
// `.map` since it reads `React.Children.toArray`) into the wire item shape the
// native side expects, plus the client-side handler and keydown-shortcut maps.
// ---------------------------------------------------------------------------

function resolveClientHandler(client: string, props: any, ctx: ParseCtx): () => void {
  switch (client) {
    case 'reload':
      return () => window.location.reload()
    case 'navigate': {
      const to = props.to as string
      return () => ctx.router.push(to)
    }
    case 'run':
      return props.action as () => void | Promise<void>
    default:
      return () => {}
  }
}

function parseContent(children: ReactNode, ctx: ParseCtx): WireMenuItem[] {
  const items: WireMenuItem[] = []

  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue
    const type = child.type as any
    const kind = type?.__murasaki

    if (kind === 'separator') {
      items.push({ id: ctx.nextId(), role: 'separator' })
      continue
    }

    if (kind === 'sub') {
      const props = child.props as ContextMenuSubProps
      const id = ctx.nextId()
      const submenu = parseContent(props.children, ctx)
      items.push({ id, label: props.label, submenu })
      continue
    }

    if (kind === 'item') {
      const props = child.props as ContextMenuItemProps
      const id = ctx.nextId()
      const action = Children.toArray(props.children).find(
        (c): c is ReactElement => isValidElement(c) && (c.type as any)?.__murasaki === 'action',
      )
      if (!action) {
        console.warn(`[murasaki] <ContextMenuItem label="${props.label}"> has no Action.* child — skipping.`)
        continue
      }

      const actionType = action.type as any
      const wireItem: WireMenuItem = { id, label: props.label, enabled: !props.disabled }

      if (actionType.__role) {
        wireItem.role = actionType.__role
      } else if (actionType.__client) {
        const handler = resolveClientHandler(actionType.__client, action.props, ctx)
        ctx.handlers.set(id, handler)
      }

      if (props.shortcut) {
        const { accelerator, matches } = parseShortcut(props.shortcut)
        wireItem.accelerator = accelerator
        if (actionType.__client) {
          ctx.shortcuts.push({ matches, run: ctx.handlers.get(id)! })
        }
      }

      items.push(wireItem)
      continue
    }
  }

  return items
}
