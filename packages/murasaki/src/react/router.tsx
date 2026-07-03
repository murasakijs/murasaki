import { createContext, useContext, useEffect, useState } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

interface RouterCtx {
  pathname: string
  push(to: string): void
  replace(to: string): void
  back(): void
}

const Ctx = createContext<RouterCtx | null>(null)
const ParamsCtx = createContext<Record<string, string>>({})

export interface LinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  replace?: boolean
  children?: ReactNode
}

export function Link({ href, replace, children, onClick, ...rest }: LinkProps) {
  const router = useContext(Ctx)
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.defaultPrevented) return
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onClick?.(e)
        if (router) (replace ? router.replace : router.push)(href)
        else window.history[replace ? 'replaceState' : 'pushState'](null, '', href)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}

export function useRouter(): RouterCtx {
  const ctx = useContext(Ctx)
  if (ctx) return ctx
  const [, force] = useState(0)
  useEffect(() => {
    const h = () => force((x) => x + 1)
    window.addEventListener('popstate', h)
    return () => window.removeEventListener('popstate', h)
  }, [])
  return {
    pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
    push: (to) => {
      window.history.pushState(null, '', to)
      force((x) => x + 1)
    },
    replace: (to) => {
      window.history.replaceState(null, '', to)
      force((x) => x + 1)
    },
    back: () => window.history.back(),
  }
}

export function usePathname(): string {
  return useRouter().pathname
}

/**
 * Dynamic-segment params for the currently matched route (e.g. `:slug`).
 * Populated by `<AppRouter>`; returns `{}` outside of a matched dynamic route.
 */
export function useParams(): Record<string, string> {
  return useContext(ParamsCtx)
}

export { Ctx as RouterContext, ParamsCtx as ParamsContext }
