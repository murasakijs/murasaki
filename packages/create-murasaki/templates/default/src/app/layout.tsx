import '@murasakijs/ui/styles.css'
import './globals.css'
import type { ReactNode } from 'react'
import { AppShell } from '../components/app-shell'

/**
 * Root layout — wraps every route. It only imports the global styles and mounts
 * the app shell; app-wide chrome (the frame, the app-wide context menu) lives in
 * src/components/app-shell.tsx.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
