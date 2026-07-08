import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { ParamsContext, RouterContext } from './router.js'
import { applyMetadata } from './metadata.js'
import type { GenerateMetadata, Metadata } from './metadata.js'
import type { Middleware } from './middleware.js'
import { DevErrorOverlay, reportDevError } from './error-overlay.js'

/**
 * Shape of a namespace import (`import * as mod from '...'`) for a page,
 * layout, loading, error, or not-found file — matches what the
 * `virtual:murasaki/routes` module emits.
 */
export interface RouteModule {
  default: ComponentType<any>
  metadata?: Metadata
  generateMetadata?: GenerateMetadata
}

/** Matches the entries emitted by `virtual:murasaki/routes`. */
export interface RouteEntry {
  urlPath: string
  isDynamic: boolean
  page?: RouteModule
  layout?: RouteModule
  loading?: RouteModule
  error?: RouteModule
  notFound?: RouteModule
}

export interface RouteMatch {
  route: RouteEntry
  params: Record<string, string>
}

function segmentsOf(urlPath: string): string[] {
  return urlPath.split('/').filter(Boolean)
}

/**
 * Pure route matcher — exported for unit testing.
 *
 * Static segments win over dynamic ones, and matches with more static
 * segments win over matches with fewer (more-specific over less). Only
 * entries with a `page` are matchable.
 */
export function matchRoute(routes: RouteEntry[], pathname: string): RouteMatch | null {
  const pathSegments = segmentsOf(pathname)
  let best: { route: RouteEntry; params: Record<string, string>; score: number } | null = null

  for (const route of routes) {
    if (!route.page) continue
    const routeSegments = segmentsOf(route.urlPath)
    if (routeSegments.length !== pathSegments.length) continue

    const params: Record<string, string> = {}
    let score = 0
    let ok = true
    for (let i = 0; i < routeSegments.length; i++) {
      const rs = routeSegments[i]
      const ps = pathSegments[i]
      if (rs.startsWith(':')) {
        params[rs.slice(1)] = decodeURIComponent(ps)
      } else if (rs === ps) {
        score++
      } else {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (!best || score > best.score) best = { route, params, score }
  }

  return best ? { route: best.route, params: best.params } : null
}

/** `entryUrlPath` is an ancestor of `targetUrlPath` (both in route-pattern form, e.g. `/blog/:slug`). */
function isAncestorUrlPath(entryUrlPath: string, targetUrlPath: string): boolean {
  if (entryUrlPath === '/') return true
  if (entryUrlPath === targetUrlPath) return true
  return targetUrlPath.startsWith(`${entryUrlPath}/`)
}

/** `entryUrlPath` (a route pattern) is an ancestor of a real `pathname`. */
function isAncestorOfPath(entryUrlPath: string, pathname: string): boolean {
  if (entryUrlPath === '/') return true
  const es = segmentsOf(entryUrlPath)
  const ps = segmentsOf(pathname)
  if (es.length > ps.length) return false
  for (let i = 0; i < es.length; i++) {
    const e = es[i]
    if (!e.startsWith(':') && e !== ps[i]) return false
  }
  return true
}

function byDepth(a: RouteEntry, b: RouteEntry) {
  return segmentsOf(a.urlPath).length - segmentsOf(b.urlPath).length
}

/** Shallow-merges `patch` over `base`, deep-merging `icons`/`openGraph` one level. */
function mergeMetadata(base: Metadata, patch: Metadata): Metadata {
  const merged: Metadata = { ...base, ...patch }
  if (base.icons || patch.icons) merged.icons = { ...base.icons, ...patch.icons }
  if (base.openGraph || patch.openGraph) merged.openGraph = { ...base.openGraph, ...patch.openGraph }
  return merged
}

/** Root→leaf layout metadata, then the matched page's metadata on top. */
function resolveStaticMetadata(layoutChain: RouteEntry[], route: RouteEntry): Metadata {
  let meta: Metadata = {}
  for (const entry of layoutChain) {
    if (entry.layout?.metadata) meta = mergeMetadata(meta, entry.layout.metadata)
  }
  if (route.page?.metadata) meta = mergeMetadata(meta, route.page.metadata)
  return meta
}

/** Root→leaf chain of entries carrying `key`, ancestors of the matched route's urlPath. */
function ancestorChain(
  routes: RouteEntry[],
  targetUrlPath: string,
  key: 'layout' | 'loading' | 'error',
): RouteEntry[] {
  return routes
    .filter((r) => r[key] && isAncestorUrlPath(r.urlPath, targetUrlPath))
    .sort(byDepth)
}

/** Nearest (deepest applicable) not-found entry for a raw pathname that failed to match. */
function nearestNotFound(routes: RouteEntry[], pathname: string): RouteModule | undefined {
  const chain = routes
    .filter((r) => r.notFound && isAncestorOfPath(r.urlPath, pathname))
    .sort(byDepth)
  return chain.at(-1)?.notFound
}

interface ErrorBoundaryProps {
  fallback?: ComponentType<{ error: Error; reset: () => void }>
  children: ReactNode
}
interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    if (process.env.NODE_ENV !== 'production') {
      reportDevError(error, info.componentStack ?? undefined)
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (error) {
      const Fallback = this.props.fallback
      if (Fallback) return <Fallback error={error} reset={this.reset} />
      return (
        <div style={{ padding: 24 }}>
          <p>Something went wrong.</p>
          <button type="button" onClick={this.reset}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function DefaultNotFound() {
  return (
    <div style={{ padding: 24 }}>
      <p>404 — page not found.</p>
    </div>
  )
}

/** Redirect-loop guard for `middleware` — after this many consecutive redirects, give up. */
const MAX_MIDDLEWARE_HOPS = 5

/**
 * Client-side file-based routing dispatch.
 *
 * Consumes the routes emitted by the `murasaki:routing` Vite plugin
 * (`virtual:murasaki/routes`) — murasaki itself stays routes-agnostic, so
 * the caller imports the virtual module and passes it in:
 *
 * ```tsx
 * import { routes, middleware } from 'virtual:murasaki/routes'
 * import { AppRouter } from 'murasaki'
 *
 * createRoot(el).render(<AppRouter routes={routes} middleware={middleware} />)
 * ```
 *
 * `middleware`, if given, runs before every navigation (initial mount,
 * `push`/`replace`, and browser back/forward) and can redirect it — see
 * `Middleware`.
 */
export function AppRouter({
  routes,
  middleware,
}: {
  routes: RouteEntry[]
  middleware?: Middleware
}) {
  const [pathname, setPathname] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/',
  )
  const [resolving, setResolving] = useState(() => !!middleware)
  const hopsRef = useRef(0)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const routerValue = useMemo(
    () => ({
      pathname,
      push(to: string) {
        window.history.pushState(null, '', to)
        setPathname(window.location.pathname)
      },
      replace(to: string) {
        window.history.replaceState(null, '', to)
        setPathname(window.location.pathname)
      },
      back() {
        window.history.back()
      },
    }),
    [pathname],
  )

  // Runs `middleware` before every navigation, ahead of matching/rendering.
  // No-op (and no async gate) when there's no `middleware` prop.
  useEffect(() => {
    if (!middleware) {
      setResolving(false)
      return
    }

    let cancelled = false
    setResolving(true)

    Promise.resolve(middleware({ pathname }))
      .then((result) => {
        if (cancelled) return

        const redirect = result?.redirect
        if (redirect && redirect !== pathname) {
          if (hopsRef.current >= MAX_MIDDLEWARE_HOPS) {
            console.warn(
              `[murasaki] middleware redirected ${MAX_MIDDLEWARE_HOPS}+ times in a row (possible loop) — rendering "${pathname}" as-is.`,
            )
            hopsRef.current = 0
            setResolving(false)
            return
          }
          hopsRef.current++
          window.history.replaceState(null, '', redirect)
          setPathname(window.location.pathname)
          return
        }

        hopsRef.current = 0
        setResolving(false)
      })
      .catch((err) => {
        console.error('[murasaki] middleware failed:', err)
        if (!cancelled) {
          hopsRef.current = 0
          setResolving(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [middleware, pathname])

  const match = useMemo(() => matchRoute(routes, pathname), [routes, pathname])

  const layoutChain = useMemo(
    () => (match ? ancestorChain(routes, match.route.urlPath, 'layout') : []),
    [routes, match],
  )

  const staticMetadata = useMemo(
    () => (match ? resolveStaticMetadata(layoutChain, match.route) : null),
    [match, layoutChain],
  )

  useEffect(() => {
    if (resolving || !match || !staticMetadata) return
    const generate = match.route.page?.generateMetadata
    if (!generate) {
      applyMetadata(staticMetadata)
      return
    }

    let cancelled = false
    Promise.resolve(generate({ params: match.params }))
      .then((generated) => {
        if (!cancelled) applyMetadata(mergeMetadata(staticMetadata, generated))
      })
      .catch((err) => {
        console.error('[murasaki] generateMetadata failed:', err)
        if (!cancelled) applyMetadata(staticMetadata)
      })
    return () => {
      cancelled = true
    }
  }, [match, staticMetadata, resolving])

  let element: ReactNode = null
  let params: Record<string, string> = {}

  // While `middleware` is deciding (or mid-redirect), render nothing rather
  // than flashing the requested route.
  if (!resolving) {
    if (!match) {
      const NotFound = nearestNotFound(routes, pathname)?.default ?? DefaultNotFound
      element = <NotFound />
    } else {
      const { route, params: matchedParams } = match
      params = matchedParams
      const Page = route.page!.default
      const Loading = ancestorChain(routes, route.urlPath, 'loading').at(-1)?.loading?.default
      const ErrorFallback = ancestorChain(routes, route.urlPath, 'error').at(-1)?.error?.default

      let inner: ReactNode = (
        <ErrorBoundary fallback={ErrorFallback}>
          <Suspense fallback={Loading ? <Loading /> : null}>
            <Page params={params} />
          </Suspense>
        </ErrorBoundary>
      )

      for (let i = layoutChain.length - 1; i >= 0; i--) {
        const Layout = layoutChain[i].layout!.default
        inner = <Layout>{inner}</Layout>
      }
      element = inner
    }
  }

  return (
    <>
      <RouterContext.Provider value={routerValue}>
        <ParamsContext.Provider value={params}>{element}</ParamsContext.Provider>
      </RouterContext.Provider>
      {process.env.NODE_ENV !== 'production' && <DevErrorOverlay />}
    </>
  )
}
