import './globals.css'
import type { ReactNode } from 'react'
import { Action, App, useAppMenu, useContextMenu } from 'murasaki'

export default function Layout({ children }: { children: ReactNode }) {
  useAppMenu([
    { role: 'editMenu' },
    { label: 'View', items: [{ role: 'reload' }] },
    { role: 'windowMenu' },
  ])
  useContextMenu([
    { label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> },
    { separator: true },
    { label: 'Copy', action: <Action.Copy /> },
    { label: 'Paste', action: <Action.Paste /> },
  ])
  return <App className="showcase-root">{children}</App>
}
