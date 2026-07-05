import type { ReactNode } from 'react'
import { App, useContextMenu } from 'murasaki'

/**
 * The app shell — the full-window frame every route renders into, plus the
 * app-wide right-click menu.
 *
 * useContextMenu() with no id is the whole-window default: right-click anywhere
 * a page doesn't override shows it. You declare it up here, next to nothing in
 * particular — the menu is data, separate from what you render — and murasaki
 * pops the real OS menu (NSMenu / HMENU / GtkMenu), not an HTML popup.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useContextMenu([
    { label: 'Reload', shortcut: 'command,R', action: () => location.reload() },
    { separator: true },
    { label: 'Copy', role: 'copy' },
    { label: 'Paste', role: 'paste' },
  ])

  return (
    <App className="flex items-center justify-center bg-background text-foreground">
      {children}
    </App>
  )
}
