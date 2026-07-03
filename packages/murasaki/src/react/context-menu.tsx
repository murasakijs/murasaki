/**
 * shadcn-shaped `ContextMenu` that renders as a **native OS menu**, not an
 * HTML popup. Behavior is expressed declaratively via `Action.*` children;
 * `<ContextMenuContent>` and everything inside it never actually render —
 * their children are parsed into the wire shape `useGlobalContextMenu`
 * already knows how to post (see `./rpc.ts`), and the native side pops the
 * real menu. Clicks come back as a `murasaki:menuclick` `CustomEvent` on
 * `window`; shortcuts additionally fire straight off `keydown` so they work
 * without ever opening the menu.
 *
 * Everything but `ContextMenu`/`ContextMenuTrigger` is a marker component
 * (renders `null`) that the parser below matches by `element.type`, via a
 * `__murasaki` tag stamped on the function itself — this survives
 * minification, unlike matching on `displayName` or `element.type.name`.
 */
import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useMemo, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { post } from './rpc.js'
import type { ContextMenuItem as WireMenuItem } from './rpc.js'
import { useRouter } from './router.js'
import { parseShortcut } from './shortcut.js'

// ---------------------------------------------------------------------------
// Root + context
// ---------------------------------------------------------------------------

interface ContextMenuCtxValue {
  openAt(x: number, y: number): void
}

const Ctx = createContext<ContextMenuCtxValue | null>(null)

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

export interface ContextMenuProps {
  children?: ReactNode
}

export function ContextMenu({ children }: ContextMenuProps) {
  const router = useRouter()
  const all = Children.toArray(children)
  const trigger = all.find(
    (c): c is ReactElement => isValidElement(c) && (c.type as any)?.__murasaki === 'trigger',
  )
  const content = all.find(
    (c): c is ReactElement => isValidElement(c) && (c.type as any)?.__murasaki === 'content',
  )

  const parsed = useMemo<Parsed>(() => {
    let counter = 0
    const ctx: ParseCtx = {
      handlers: new Map(),
      shortcuts: [],
      router,
      nextId: () => `m${counter++}`,
    }
    const items = content ? parseContent((content.props as { children?: ReactNode }).children, ctx) : []
    return { items, handlers: ctx.handlers, shortcuts: ctx.shortcuts }
  }, [content, router])

  // Kept in a ref so the window listeners (installed once) always see the
  // latest parse without needing to be torn down and rebuilt on every render.
  const parsedRef = useRef(parsed)
  parsedRef.current = parsed

  useEffect(() => {
    const onMenuClick = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      parsedRef.current.handlers.get(id)?.()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      for (const shortcut of parsedRef.current.shortcuts) {
        if (shortcut.matches(e)) {
          e.preventDefault()
          shortcut.run()
          break
        }
      }
    }
    window.addEventListener('murasaki:menuclick', onMenuClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('murasaki:menuclick', onMenuClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const ctxValue = useMemo<ContextMenuCtxValue>(
    () => ({
      openAt(x, y) {
        post({ kind: 'contextMenu', items: parsedRef.current.items, x, y })
      },
    }),
    [],
  )

  return <Ctx.Provider value={ctxValue}>{trigger ?? null}</Ctx.Provider>
}

// ---------------------------------------------------------------------------
// Trigger (the only child that actually renders)
// ---------------------------------------------------------------------------

export interface ContextMenuTriggerProps {
  asChild?: boolean
  children?: ReactNode
}

export function ContextMenuTrigger({ asChild, children }: ContextMenuTriggerProps) {
  const ctx = useContext(Ctx)

  const onContextMenu = (e: { preventDefault(): void; clientX: number; clientY: number }) => {
    e.preventDefault()
    ctx?.openAt(e.clientX, e.clientY)
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
;(ContextMenuTrigger as any).__murasaki = 'trigger'

// ---------------------------------------------------------------------------
// Marker components — none of these render anything; the parser reads their
// props off the element tree instead.
// ---------------------------------------------------------------------------

export interface ContextMenuContentProps {
  children?: ReactNode
}

export function ContextMenuContent(_props: ContextMenuContentProps) {
  return null
}
;(ContextMenuContent as any).__murasaki = 'content'

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
// Parser — walks the Content children (order-preserving; supports
// conditionals/`.map` since it just reads `React.Children.toArray`) and
// produces the wire item shape `useGlobalContextMenu`/the native side expect,
// plus the client-side handler and keydown-shortcut maps.
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
