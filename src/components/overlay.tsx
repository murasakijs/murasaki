// Overlay & navigation components — Tooltip, Tabs, ContextMenu.

import { useState } from '../jsx/dom/runtime.ts'
import { jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'

// ── Tooltip (CSS-only hover) ────────────────────────────────────────
// Pure CSS solution: wraps child in a span, the tooltip bubble is
// position:absolute under it, shown via :hover on the wrapper.
export function Tooltip(props: {
  text: string
  position?: 'top' | 'bottom'
  children?: Child
  className?: string
}) {
  const pos = props.position ?? 'top'
  const wrap: Record<string, unknown> = {
    position: 'relative',
    display: 'inline-flex',
    // The bubble lives in ::before pseudo-class via a real child kept
    // hidden until hover. We use opacity transition for nicer feel.
  }
  // Workaround: pure inline-style :hover doesn't exist, so we just include
  // the bubble + a tiny CSS rule via <style scoped></style>... but inline
  // styles can't do :hover either. Use a <style> tag emitted once per call.
  // Pragmatic: rely on the user's globals.css to opt into hover, OR use
  // pointer events + JS state. Picking JS state for portability:
  const [hover, setHover] = useState(false)
  const bubble: Record<string, unknown> = {
    position: 'absolute',
    [pos === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.85)',
    color: '#fff',
    fontSize: '11px',
    padding: '4px 8px',
    borderRadius: '6px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    opacity: hover ? 1 : 0,
    transition: 'opacity 0.12s',
    zIndex: 1500,
  }
  return jsx('span', {
    className: props.className,
    style: wrap,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    children: [props.children, jsx('span', { style: bubble, children: props.text })],
  })
}

// ── Tabs / Tab / TabPanel ───────────────────────────────────────────
// Controlled tabs: parent owns the active value via useState.
//
//   const [tab, setTab] = useState('a')
//   <Tabs value={tab} onChange={setTab}>
//     <TabList>
//       <Tab value="a">A</Tab>
//       <Tab value="b">B</Tab>
//     </TabList>
//     <TabPanel value="a" active={tab}>Content A</TabPanel>
//     <TabPanel value="b" active={tab}>Content B</TabPanel>
//   </Tabs>

export function Tabs(props: {
  value: string
  onChange?: (v: string) => void
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  return jsx('div', {
    className: props.className,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      ...(props.style ?? {}),
    },
    'data-murasaki-tabs-value': props.value,
    children: props.children,
  })
}

export function TabList(props: {
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  return jsx('div', {
    className: props.className,
    style: {
      display: 'flex',
      gap: '4px',
      borderBottom: '1px solid rgba(0,0,0,0.08)',
      ...(props.style ?? {}),
    },
    children: props.children,
  })
}

export function Tab(props: {
  value: string
  active?: boolean
  onClick?: () => void
  // For Tabs auto-wire (not auto-detected without context, so consumers
  // pass active explicitly or use TabsAuto).
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    color: props.active ? '#5B21B6' : 'inherit',
    borderBottom: `2px solid ${props.active ? '#A855F7' : 'transparent'}`,
    marginBottom: '-1px',
    transition: 'color 0.1s, border-color 0.1s',
    ...(props.style ?? {}),
  }
  return jsx('div', {
    className: props.className,
    onClick: props.onClick,
    style,
    children: props.children,
  })
}

export function TabPanel(props: {
  value: string
  active: string
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  if (props.value !== props.active) return null
  return jsx('div', { className: props.className, style: props.style, children: props.children })
}

// ── ContextMenu (right-click) ───────────────────────────────────────
export type ContextMenuItem =
  | { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }
  | { type: 'separator' }

export function ContextMenu(props: {
  items: ContextMenuItem[]
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const wrap: Record<string, unknown> = {
    display: 'inline-block',
    ...(props.style ?? {}),
  }

  const onContextMenu = (e: Event) => {
    e.preventDefault()
    const me = e as unknown as { clientX: number; clientY: number }
    setPos({ x: me.clientX, y: me.clientY })
    setOpen(true)
  }

  const closeOnAny = () => setOpen(false)

  const menu = open
    ? jsx('div', {
        // Backdrop catches clicks outside to close.
        style: {
          position: 'fixed',
          inset: '0',
          zIndex: 2000,
        },
        onClick: closeOnAny,
        onContextMenu: (e: Event) => {
          e.preventDefault()
          closeOnAny()
        },
        children: jsx('div', {
          style: {
            position: 'absolute',
            top: `${pos.y}px`,
            left: `${pos.x}px`,
            minWidth: '180px',
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            padding: '4px',
            fontSize: '13px',
          },
          onClick: (e: Event) => {
            // Stop propagation so menu items can fire onClick first
            ;(e as { stopPropagation?: () => void }).stopPropagation?.()
          },
          children: props.items.map((it, i) =>
            'type' in it && it.type === 'separator'
              ? jsx('div', {
                  key: `sep-${i}`,
                  style: {
                    height: '1px',
                    background: 'rgba(0,0,0,0.08)',
                    margin: '4px 0',
                  },
                })
              : jsx('div', {
                  key: `it-${i}`,
                  style: {
                    padding: '6px 12px',
                    borderRadius: '4px',
                    cursor:
                      'disabled' in it && it.disabled ? 'not-allowed' : 'pointer',
                    color:
                      'danger' in it && it.danger
                        ? '#dc2626'
                        : 'disabled' in it && it.disabled
                          ? 'rgba(0,0,0,0.4)'
                          : 'inherit',
                  },
                  onClick: () => {
                    if ('disabled' in it && it.disabled) return
                    ;('onClick' in it ? it.onClick : undefined)?.()
                    closeOnAny()
                  },
                  children: 'label' in it ? it.label : '',
                }),
          ),
        }),
      })
    : null

  return jsx('div', {
    className: props.className,
    style: wrap,
    onContextMenu,
    children: [props.children, menu],
  })
}
