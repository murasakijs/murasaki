import type { ReactNode } from 'react'
import { WindowChrome } from './window-chrome.js'

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
 * Hosts the built-in custom title bar (`<WindowChrome>`) above the content
 * region. `WindowChrome` self-hides everywhere it doesn't apply (native
 * title bar platforms, real macOS, no native host at all), so it's always
 * safe to mount — when hidden, the content region below still fills the
 * full viewport and gets the caller's `className` exactly as before.
 *
 * The frame size (`height: 100vh; width: 100%`) is an inline style on
 * purpose: this component lives in murasaki's dist, which an app's Tailwind
 * `content` globs don't scan — a `h-screen` class here would never be
 * generated, collapsing the frame to its content height. Inline styling keeps
 * murasaki's core independent of the app's Tailwind config.
 */
export function App({ children, className }: AppProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
      <WindowChrome />
      <div className={className} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}
