import '@murasakijs/ui/styles.css'
import './globals.css'
import type { ReactNode } from 'react'
import { App } from 'murasaki'

export default function Layout({ children }: { children: ReactNode }) {
  return <App className="orglia-root">{children}</App>
}
