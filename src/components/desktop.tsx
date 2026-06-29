// Desktop-shaped components.
// macOS-first styling. Each is a normal HTML/CSS construct under the hood
// — what they give you is a sensible default look + the right WKWebView
// attributes (drag region, no context menu, etc.).

import { jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'

/**
 * Custom title bar. Drag the bar to move the window (WKWebView drag region).
 * On macOS, leaves space for the traffic-light buttons on the left.
 *
 *   <TitleBar>
 *     <Text weight="medium">My App</Text>
 *   </TitleBar>
 */
export function TitleBar(props: {
  children?: Child
  className?: string
  /** background tint (default: faint vibrancy) */
  background?: string
  /** override left padding for traffic-light area (default 80px on darwin) */
  leftInset?: number
  height?: number
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    height: `${props.height ?? 38}px`,
    display: 'flex',
    alignItems: 'center',
    paddingLeft: `${props.leftInset ?? 80}px`,
    paddingRight: '12px',
    background: props.background ?? 'rgba(168, 85, 247, 0.04)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    // The magic that makes the bar draggable in a WKWebView.
    WebkitAppRegion: 'drag',
    userSelect: 'none',
    fontSize: '13px',
    fontWeight: 500,
    ...(props.style ?? {}),
  }
  return jsx('div', {
    className: props.className,
    'data-murasaki-titlebar': '',
    style,
    children: props.children,
  })
}

/**
 * Make a child interactive inside a draggable TitleBar.
 * Buttons in a drag-region don't receive clicks by default — wrap them in
 * <NoDrag> to opt out.
 */
export function NoDrag(props: { children?: Child; className?: string }) {
  return jsx('div', {
    className: props.className,
    style: { WebkitAppRegion: 'no-drag' as unknown as string },
    children: props.children,
  })
}

/**
 * Vertical side panel — typical macOS Mail/Finder/Settings look.
 *
 *   <Sidebar width={240}>
 *     <SidebarItem>Inbox</SidebarItem>
 *     <SidebarItem active>Sent</SidebarItem>
 *   </Sidebar>
 */
export function Sidebar(props: {
  children?: Child
  className?: string
  width?: number
  background?: string
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    width: `${props.width ?? 220}px`,
    flexShrink: 0,
    height: '100%',
    overflow: 'auto',
    background: props.background ?? 'rgba(168, 85, 247, 0.03)',
    borderRight: '1px solid rgba(0,0,0,0.06)',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    ...(props.style ?? {}),
  }
  return jsx('aside', { className: props.className, style, children: props.children })
}

export function SidebarItem(props: {
  children?: Child
  active?: boolean
  className?: string
  onClick?: (e: Event) => void
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    padding: '6px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    color: props.active ? '#A855F7' : 'inherit',
    background: props.active ? 'rgba(168, 85, 247, 0.12)' : 'transparent',
    fontWeight: props.active ? 600 : 400,
    ...(props.style ?? {}),
  }
  return jsx('div', {
    className: props.className,
    style,
    onClick: props.onClick,
    children: props.children,
  })
}

/**
 * Horizontal toolbar — typical row of action buttons under the title bar.
 *
 *   <Toolbar>
 *     <button>Save</button>
 *     <button>Open</button>
 *   </Toolbar>
 */
export function Toolbar(props: {
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: 'rgba(168, 85, 247, 0.02)',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    ...(props.style ?? {}),
  }
  return jsx('div', {
    className: props.className,
    'data-murasaki-toolbar': '',
    style,
    children: props.children,
  })
}

/**
 * Bottom status bar — for hints, sync indicators, etc.
 *
 *   <StatusBar>
 *     <Text size={11} color="#888">Ready</Text>
 *   </StatusBar>
 */
export function StatusBar(props: {
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    background: 'rgba(168, 85, 247, 0.04)',
    borderTop: '1px solid rgba(0,0,0,0.06)',
    fontSize: '11px',
    color: 'rgba(0,0,0,0.55)',
    userSelect: 'none',
    ...(props.style ?? {}),
  }
  return jsx('div', {
    className: props.className,
    'data-murasaki-statusbar': '',
    style,
    children: props.children,
  })
}

/**
 * Generic content pane. Fills remaining horizontal space next to a Sidebar.
 */
export function Pane(props: {
  children?: Child
  className?: string
  style?: Record<string, unknown>
}) {
  const style: Record<string, unknown> = {
    flex: 1,
    overflow: 'auto',
    padding: '20px',
    ...(props.style ?? {}),
  }
  return jsx('main', { className: props.className, style, children: props.children })
}
