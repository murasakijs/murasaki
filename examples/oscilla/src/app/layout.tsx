import './globals.css'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return <><title>Oscilla — API Workbench</title><div className="app-frame">{children}</div></>
}
