import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center">
      {children}
    </div>
  )
}
