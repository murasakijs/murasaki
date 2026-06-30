// <ThemeProvider> + useTheme()
//
// SSR: emits a <style data-murasaki-theme> block with CSS variables.
// CSR: same style tag is hydrated by the murasaki/jsx/dom runtime, and
//      ThemeProvider keeps it in sync if `theme` changes at runtime.

import { useEffect, useState } from '../jsx/dom/runtime.ts'
import { jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'
import { defaultDarkTheme, defaultLightTheme, type Theme, themeToCss } from '../theme.ts'

/**
 * Wrap the app in a ThemeProvider to inject CSS variables for all murasaki
 * components.
 *
 *   <ThemeProvider theme={defaultDarkTheme}>
 *     <App />
 *   </ThemeProvider>
 *
 * If `theme` is omitted, light is the default. Pass `auto` to follow the OS.
 */
export function ThemeProvider(props: {
  theme?: Theme | 'auto'
  children?: Child
}) {
  // Auto-follow OS theme when requested
  const [resolved, setResolved] = useState<Theme>(() => {
    if (props.theme === 'auto' || props.theme === undefined) {
      if (typeof window !== 'undefined') {
        const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
        return dark ? defaultDarkTheme : defaultLightTheme
      }
      return defaultLightTheme
    }
    return props.theme
  })

  // Update when prop changes (manual override)
  useEffect(() => {
    if (props.theme && props.theme !== 'auto') {
      setResolved(props.theme)
    }
  }, [props.theme])

  // Broadcast theme changes so useTheme() subscribers re-render.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('murasaki:theme', { detail: resolved }))
  }, [resolved])

  // Listen to OS theme changes when auto
  useEffect(() => {
    if (props.theme !== 'auto' && props.theme !== undefined) return
    if (typeof window === 'undefined') return
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handle = () => setResolved(mq.matches ? defaultDarkTheme : defaultLightTheme)
    mq.addEventListener?.('change', handle)
    return () => mq.removeEventListener?.('change', handle)
  }, [props.theme])

  // Emit CSS vars under :root. We render as inline <style>; both SSR and
  // client take the same string.
  const css = `:root{${themeToCss(resolved)}}`
  return jsx(Fragment, {
    children: [
      jsx('style', {
        'data-murasaki-theme': '',
        dangerouslySetInnerHTML: { __html: css },
      }),
      props.children,
    ],
  })
}

function Fragment(props: { children?: Child }): Child {
  return props.children ?? null
}

/**
 * Returns the currently active theme. On the server this is the initial
 * value (provider's prop or light). On the client it reflects live updates.
 */
export function useTheme(): Theme {
  const [t, setT] = useState<Theme>(defaultLightTheme)
  // The provider hijacks via a custom event. Simple and Context-less.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) setT(detail as Theme)
    }
    window.addEventListener('murasaki:theme', handler as EventListener)
    return () => window.removeEventListener('murasaki:theme', handler as EventListener)
  }, [])
  return t
}
