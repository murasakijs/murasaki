import './globals.css'
import type { ReactNode } from 'react'
import { Action, App, useAppMenu, useContextMenu } from 'murasaki'

export default function Layout({ children }: { children: ReactNode }) {
  useAppMenu([
    { role: 'editMenu' },
    { label: 'View', items: [{ role: 'reload' }] },
    { role: 'windowMenu' },
  ])
  useContextMenu([{ label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> }, { label: 'Copy', action: <Action.Copy /> }])
  return <App className="showcase-root">{children}</App>
}
