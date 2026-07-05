import type { ReactNode } from 'react'

export interface AppProps {
  children?: ReactNode
  /** Extra classes merged onto the full-window frame (e.g. background, centering). */
  className?: string
}

/**
 * The app root frame — a full-window (`min-h-screen w-full`) container every
 * route renders into. Use it as the top-level element of your root layout
 * instead of a bare fragment, and layer on your own classes (background,
 * centering, …) via `className`.
 */
export function App({ children, className }: AppProps) {
  const cls = className ? `min-h-screen w-full ${className}` : 'min-h-screen w-full'
  return <div className={cls}>{children}</div>
}
