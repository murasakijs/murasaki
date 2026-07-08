import type { ReactNode } from 'react'

export interface AppProps {
  children?: ReactNode
  /** Extra classes merged onto the frame (e.g. background, centering). */
  className?: string
}

/**
 * The app root frame — a full-size container you render into as the top-level
 * element of your root layout, layering on your own classes (background,
 * centering, …) via `className`.
 *
 * The custom title bar — and the space it reserves — is deliberately NOT here.
 * murasaki wraps it around your whole app at the router level (WindowFrame in
 * window-chrome.tsx), ABOVE this component, so it can't be removed or broken by
 * editing your layout. `<App>` is purely a convenience wrapper for your content:
 * it fills the content region and grows/scrolls with what you put in it.
 *
 * The size is an inline style on purpose: this component lives in murasaki's
 * dist, which an app's Tailwind `content` globs don't scan — a `min-h-full`
 * class here would never be generated. Inline styling keeps murasaki's core
 * independent of the app's Tailwind config.
 */
export function App({ children, className }: AppProps) {
  return (
    <div style={{ minHeight: '100%', width: '100%' }} className={className}>
      {children}
    </div>
  )
}
