import type { ReactNode } from 'react'
import { App } from 'murasaki'
import './globals.css'

export default function RootLayout({ children }: { children: ReactNode }) {
  return <App className="papelle-root">{children}</App>
}
