import '@murasakijs/ui/styles.css'
import './globals.css'
import type { ReactNode } from 'react'
import { App, useAppMenu, useContextMenu } from 'murasaki'
import { Action } from '@/lib/action'

/**
 * Root layout — wraps every route. It declares the app-wide right-click menu
 * (no id = the whole window) and the native app menu bar (top of screen on
 * macOS, a window menu bar on Windows), then renders children inside the
 * <App> frame. Actions come from src/lib/action.ts (built-ins + your own).
 */
export default function Layout({ children }: { children: ReactNode }) {
  useContextMenu([
    { label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> },
    { separator: true },
    { label: 'Copy', action: <Action.Copy /> },
    { label: 'Paste', action: <Action.Paste /> },
  ])

  useAppMenu([
    // `{ role }` pulls in a standard, localized, natively-behaving item/menu;
    // a custom item runs your own `action` (a built-in <Action.* /> or a plain
    // function). macOS auto-adds the app-name menu (About/Quit) ahead of these.
    { label: 'File', items: [{ role: 'close' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      items: [{ label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> }],
    },
  ])

  return (
    <App className="flex items-center justify-center bg-background text-foreground">
      {children}
    </App>
  )
}
