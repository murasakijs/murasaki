import type { ReactNode } from 'react'

export interface AppProps {
  children?: ReactNode
  /** Extra classes merged onto the full-window frame (e.g. background, centering). */
  className?: string
}

/**
 * The app root frame — a full-window container every route renders into. Use it
 * as the top-level element of your root layout instead of a bare fragment, and
 * layer on your own classes (background, centering, …) via `className`.
 *
 * The frame size (`min-height: 100vh; width: 100%`) is an inline style on
 * purpose: this component lives in murasaki's dist, which an app's Tailwind
 * `content` globs don't scan — a `min-h-screen` class here would never be
 * generated, collapsing the frame to its content height. Inline styling keeps
 * murasaki's core independent of the app's Tailwind config.
 */
export function App({ children, className }: AppProps) {
  return (
    <div style={{ minHeight: '100vh', width: '100%' }} className={className}>
      {children}
    </div>
  )
}
