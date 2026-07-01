// Public types + client-side runtime for the murasaki right-click menu.
//
// Server-side: users declare the default menu via murasaki.config.ts under
// `webview.contextMenu`. build.ts serialises that list into the client
// bundle so it's available at hydrate time — no runtime IPC needed.
//
// Client-side: pages can further override / extend the menu with the
// `useGlobalContextMenu(items)` hook (see rpc-client.ts for the export).
// The renderer here treats the merged list (config default + hook override)
// as the authoritative source and rebuilds a floating menu on each
// contextmenu event.

export type GlobalContextMenuAction =
  | 'reload'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'selectAll'
  | 'quit'
  | 'about'
  | 'toggleFullscreen'

export type GlobalContextMenuItem = {
  /** Text displayed in the menu row. Ignored when `separator: true`. */
  label?: string
  /**
   * Built-in action to fire when the item is clicked. Convenient shortcut
   * for common commands — bypasses the need for a client-side handler.
   */
  action?: GlobalContextMenuAction
  /**
   * A custom event name. When clicked, the client dispatches
   *   window.dispatchEvent(new CustomEvent(event, { detail: { x, y } }))
   * so any page-side code can react without wiring up per-page config.
   */
  event?: string
  /** Optional keyboard hint rendered on the right side. Purely decorative. */
  shortcut?: string
  /** Icon character or short string rendered to the left of `label`. */
  icon?: string
  /** Disables click + dims the row. */
  disabled?: boolean
  /** Draws a horizontal separator instead of a row. */
  separator?: boolean
  /**
   * Nested submenu. When present, hovering the row opens a second-level
   * flyout to the right (or left near a screen edge).
   */
  submenu?: GlobalContextMenuItem[]
}
