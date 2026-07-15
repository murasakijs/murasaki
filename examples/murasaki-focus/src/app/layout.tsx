import './globals.css'
import type { ReactNode } from 'react'
import { Action, App, useAppMenu, useContextMenu } from 'murasaki'

export default function Layout({ children }: { children: ReactNode }) {
  useAppMenu([
    { role: 'editMenu' },
    { label: 'Session', items: [{ label: 'Start / Pause', shortcut: 'space', action: <Action.Run action={() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })) }} /> }, { role: 'reload' }] },
    { role: 'windowMenu' },
  ])
  useContextMenu([{ label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> }])
  return <App className="showcase-root">{children}</App>
}
