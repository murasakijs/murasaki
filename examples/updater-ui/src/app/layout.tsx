import '@murasakijs/ui/styles.css'
import './globals.css'
import type { ReactNode } from 'react'
import { App, useContextMenu } from 'murasaki'
import { Action } from '@/lib/action'

/**
 * Root layout — wraps every route. It declares the app-wide right-click menu
 * (no id = the whole window), then renders children inside the <App> frame.
 * Actions come from src/lib/action.ts (built-ins + your own).
 *
 * The app gets murasaki's standard native menu bar by default (top of screen
 * on macOS, a window menu bar on Windows). To define your own, add a
 * `useAppMenu([...])` call here — see the "App menu" guide in the docs.
 */
export default function Layout({ children }: { children: ReactNode }) {
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
