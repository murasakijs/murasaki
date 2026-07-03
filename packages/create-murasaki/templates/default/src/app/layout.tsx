import '@murasakijs/ui/styles.css'
import './globals.css'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground">
      {children}
    </div>
  )
}
