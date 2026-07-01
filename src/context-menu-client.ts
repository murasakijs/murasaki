// Client-side runtime for murasaki's right-click menu.
//
// build.ts embeds the config's default items via
//   window.__murasakiCtxMenu__ = { defaults: [...] }
// and this module renders a floating menu on `contextmenu` events. Pages
// can extend or replace the list at runtime with `useGlobalContextMenu`.

import { useEffect } from './jsx/dom/runtime.ts'
import type { GlobalContextMenuItem } from './runtime/context-menu.ts'

type State = {
  defaults: GlobalContextMenuItem[]
  overrides: GlobalContextMenuItem[] | null
  boundElement: HTMLElement | null
}

declare global {
  interface Window {
    __murasakiCtxMenu__?: State
  }
}

function state(): State {
  if (typeof window === 'undefined') return { defaults: [], overrides: null, boundElement: null }
  if (!window.__murasakiCtxMenu__) {
    window.__murasakiCtxMenu__ = { defaults: [], overrides: null, boundElement: null }
  }
  return window.__murasakiCtxMenu__
}

function effectiveItems(): GlobalContextMenuItem[] {
  const s = state()
  return s.overrides ?? s.defaults
}

/**
 * Called once from the client bundle top-level to install the contextmenu
 * listener and register the config-supplied defaults.
 */
export function installGlobalContextMenu(defaults: GlobalContextMenuItem[]): void {
  if (typeof window === 'undefined') return
  const s = state()
  s.defaults = defaults
  if (s.boundElement) return
  s.boundElement = document.body
  document.addEventListener(
    'contextmenu',
    (e) => {
      const items = effectiveItems()
      if (!items.length) return
      e.preventDefault()
      renderMenu(items, (e as MouseEvent).clientX, (e as MouseEvent).clientY)
    },
    true,
  )
}

/**
 * Page-level hook — replaces the config default with your list until the
 * component unmounts. Empty array to disable the menu on this page.
 */
export function useGlobalContextMenu(items: GlobalContextMenuItem[]): void {
  useEffect(() => {
    const s = state()
    const prev = s.overrides
    s.overrides = items
    return () => {
      // Restore whatever was in place before this hook ran (usually null).
      s.overrides = prev
    }
  }, [JSON.stringify(items)])
}

// ── renderer ──────────────────────────────────────────────────────
let openMenu: HTMLElement | null = null

function closeMenu(): void {
  if (openMenu) {
    openMenu.remove()
    openMenu = null
  }
}

function runAction(item: GlobalContextMenuItem, x: number, y: number): void {
  if (item.event) {
    window.dispatchEvent(new CustomEvent(item.event, { detail: { x, y, item } }))
    return
  }
  switch (item.action) {
    case 'reload':
      window.location.reload()
      break
    case 'copy':
      document.execCommand('copy')
      break
    case 'cut':
      document.execCommand('cut')
      break
    case 'paste':
      document.execCommand('paste')
      break
    case 'selectAll':
      document.execCommand('selectAll')
      break
    case 'toggleFullscreen':
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen?.()
      break
    case 'quit':
      // Fires on native side via the IPC channel already used for actions.
      // We simply forward — server ignores if no handler.
      try {
        (window as { ipc?: { postMessage: (s: string) => void } }).ipc?.postMessage(
          JSON.stringify({ kind: 'call', id: 'ctx-quit', name: '__murasaki_quit__', args: [] }),
        )
      } catch {}
      break
    case 'about':
      try {
        (window as { ipc?: { postMessage: (s: string) => void } }).ipc?.postMessage(
          JSON.stringify({ kind: 'call', id: 'ctx-about', name: '__murasaki_about__', args: [] }),
        )
      } catch {}
      break
  }
}

function renderMenu(items: GlobalContextMenuItem[], x: number, y: number): void {
  closeMenu()
  const menu = document.createElement('div')
  menu.setAttribute('data-murasaki', 'context-menu')
  Object.assign(menu.style, {
    position: 'fixed',
    top: `${y}px`,
    left: `${x}px`,
    zIndex: '999999',
    background: 'var(--m-bg-elevated, #1e1030)',
    color: 'var(--m-fg, #f2e6ff)',
    border: '1px solid var(--m-border, #3a2554)',
    borderRadius: '8px',
    padding: '4px',
    minWidth: '180px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
    font: '13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    userSelect: 'none',
  } as Partial<CSSStyleDeclaration>)

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div')
      Object.assign(sep.style, {
        height: '1px',
        background: 'var(--m-border, #3a2554)',
        margin: '4px 8px',
      } as Partial<CSSStyleDeclaration>)
      menu.appendChild(sep)
      continue
    }
    const row = document.createElement('div')
    row.textContent = ''
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      borderRadius: '4px',
      cursor: item.disabled ? 'default' : 'pointer',
      opacity: item.disabled ? '0.4' : '1',
    } as Partial<CSSStyleDeclaration>)
    if (item.icon) {
      const ic = document.createElement('span')
      ic.textContent = item.icon
      ic.style.width = '16px'
      row.appendChild(ic)
    }
    const label = document.createElement('span')
    label.textContent = item.label ?? ''
    label.style.flex = '1'
    row.appendChild(label)
    if (item.shortcut) {
      const sc = document.createElement('span')
      sc.textContent = item.shortcut
      Object.assign(sc.style, {
        opacity: '0.6',
        fontSize: '11px',
        marginLeft: '12px',
      } as Partial<CSSStyleDeclaration>)
      row.appendChild(sc)
    }
    if (!item.disabled) {
      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--m-hover, rgba(168,85,247,0.15))'
      })
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent'
      })
      row.addEventListener('click', (ev) => {
        ev.stopPropagation()
        closeMenu()
        runAction(item, x, y)
      })
    }
    menu.appendChild(row)
  }

  document.body.appendChild(menu)
  openMenu = menu

  // Reposition if it overflows the viewport.
  const rect = menu.getBoundingClientRect()
  const dx = Math.min(0, window.innerWidth - rect.right - 8)
  const dy = Math.min(0, window.innerHeight - rect.bottom - 8)
  if (dx || dy) {
    menu.style.left = `${x + dx}px`
    menu.style.top = `${y + dy}px`
  }

  // Close on outside click / scroll / escape.
  const dismiss = (): void => {
    closeMenu()
    document.removeEventListener('mousedown', outside, true)
    document.removeEventListener('scroll', dismiss, true)
    document.removeEventListener('keydown', esc, true)
  }
  const outside = (ev: Event): void => {
    if (!menu.contains(ev.target as Node)) dismiss()
  }
  const esc = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') dismiss()
  }
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('scroll', dismiss, true)
    document.addEventListener('keydown', esc, true)
  }, 0)
}
