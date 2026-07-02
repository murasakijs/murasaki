import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

type Mode = 'light' | 'dark' | 'system'

interface ThemeCtx {
  mode: Mode
  resolved: 'light' | 'dark'
  setMode(mode: Mode): void
}

const Ctx = createContext<ThemeCtx | null>(null)

export function ThemeProvider({
  defaultMode = 'system',
  children,
}: {
  defaultMode?: Mode
  children: ReactNode
}) {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof localStorage === 'undefined') return defaultMode
    return (localStorage.getItem('murasaki:theme') as Mode | null) ?? defaultMode
  })
  const [systemDark, setSystemDark] = useState(() =>
    typeof matchMedia === 'undefined'
      ? false
      : matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const m = matchMedia('(prefers-color-scheme: dark)')
    const h = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  const resolved: 'light' | 'dark' =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    if (typeof localStorage !== 'undefined')
      localStorage.setItem('murasaki:theme', mode)
  }, [mode, resolved])
  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be inside <ThemeProvider>')
  return ctx
}

/**
 * `<T />` — theme-aware text element carried over from v0.25. Renders a
 * `<span>` whose color follows the resolved theme.
 */
export function T({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'muted' | 'strong'
}) {
  const cls =
    tone === 'muted'
      ? 'text-slate-500 dark:text-slate-400'
      : tone === 'strong'
        ? 'text-slate-900 dark:text-slate-100 font-medium'
        : 'text-slate-800 dark:text-slate-200'
  return <span className={cls}>{children}</span>
}
