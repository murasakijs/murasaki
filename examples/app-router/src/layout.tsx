// src/layout.tsx — wraps your app. Edit me to change the global shell.
// Global styles live in src/globals.css (auto-injected by murasaki).

import type { Metadata } from 'murasaki'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Murasaki App',
  description: 'A desktop app built with Murasaki.',
  window: {
    width: 1280,
    height: 800,
  },
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>{children}</body>
    </html>
  )
}
