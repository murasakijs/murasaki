// src/app/layout.tsx — root layout. Wraps every route.
// ThemeProvider injects CSS variables for all murasaki components.

import { ThemeProvider, ToastProvider, type Metadata } from 'murasaki'
import type { Child } from 'murasaki/jsx'

export const metadata: Metadata = {
  title: 'Murasaki App',
  description: 'A desktop app built with Murasaki.',
  window: {
    width: 1280,
    height: 800,
  },
}

export default function RootLayout({ children }: { children?: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <ThemeProvider theme="auto">
          {children}
          <ToastProvider />
        </ThemeProvider>
      </body>
    </html>
  )
}
