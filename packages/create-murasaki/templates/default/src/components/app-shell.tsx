import type { ReactNode } from 'react'
import { App, useContextMenu } from 'murasaki'
import { Action } from '@/lib/action'

/**
 * The app shell — the full-window frame every route renders into, plus the
 * app-wide right-click menu. `Action` comes from src/lib/action.ts (built-ins +
 * your own), so <Action.Reload /> and <Action.increment /> live in one place.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useContextMenu([
    { label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> },
    { separator: true },
    { label: 'Copy', action: <Action.Copy /> },
    { label: 'Paste', action: <Action.Paste /> },
  ])

  return (
    <App className="flex items-center justify-center bg-background text-foreground">
      {children}
    </App>
  )
}
