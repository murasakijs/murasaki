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
  params: Record<string, string | string[]>
}

function segmentsOf(urlPath: string): string[] {
  return urlPath.split('/').filter(Boolean)
}

type SegmentKind = 'static' | 'dynamic' | 'catchAll' | 'optionalCatchAll'

/**
 * Classifies a normalized route segment (`vite-plugin/routing.ts`'s
 * `normalizeSegment`): `:name` (dynamic), `:name*` (catch-all, from
 * `[...name]`), `:name?*` (optional catch-all, from `[[...name]]`), or a
 * plain literal segment. Same convention as the API router's route sources
 * (`vite-plugin/api-routes.ts`).
 */
function segmentKind(seg: string): SegmentKind {
  if (!seg.startsWith(':')) return 'static'
  if (seg.endsWith('?*')) return 'optionalCatchAll'
  if (seg.endsWith('*')) return 'catchAll'
  return 'dynamic'
}

/**
 * Matches `pathSegments` against one route's `routeSegments`. A trailing
 * catch-all or optional catch-all segment consumes every remaining path
 * segment as a `string[]` param — an empty match is rejected for a required
 * catch-all, and left unset (not `[]`) for an optional one, matching
 * `matchApiRoute`'s (vite-plugin/api-routes.ts) behavior for API routes.
 *
 * Static segments score 100, dynamic 10, catch-all 1, optional catch-all 0 —
 * same specificity order as `matchApiRoute`, so static > dynamic > catch-all
 * > optional catch-all wins ties between overlapping routes.
 */
function matchSegments(
  routeSegments: string[],
  pathSegments: string[],
): { params: Record<string, string | string[]>; score: number } | null {
  const params: Record<string, string | string[]> = {}
  let score = 0
  let i = 0
  for (let r = 0; r < routeSegments.length; r++) {
    const seg = routeSegments[r]
    const kind = segmentKind(seg)
    const isTrailingCatchAll = r === routeSegments.length - 1
      && (kind === 'catchAll' || kind === 'optionalCatchAll')
    if (isTrailingCatchAll) {
      const name = kind === 'catchAll' ? seg.slice(1, -1) : seg.slice(1, -2)
      const rest = pathSegments.slice(i)
      if (rest.length === 0) {
        if (kind === 'catchAll') return null
        // Optional catch-all also matches its parent path — leave unset.
      } else {
        params[name] = rest.map((s) => decodeURIComponent(s))
        if (kind === 'catchAll') score += 1
      }
      i = pathSegments.length
      continue
    }

    if (i >= pathSegments.length) return null
    const ps = pathSegments[i]
    if (kind === 'dynamic') {
      params[seg.slice(1)] = decodeURIComponent(ps)
      score += 10
    } else if (seg === ps) {
      score += 100
    } else {
      return null
    }
    i++
  }
  return i === pathSegments.length ? { params, score } : null
}

/**
 * Pure route matcher — exported for unit testing.
 *
 * Static segments win over dynamic ones, dynamic over catch-all, and
 * catch-all over optional catch-all; among same-kind matches, more static
 * segments win over fewer (more-specific over less). Only entries with a
 * `page` are matchable.
 */
export function matchRoute(routes: RouteEntry[], pathname: string): RouteMatch | null {
  const pathSegments = segmentsOf(pathname)
  let best: { route: RouteEntry; params: Record<string, string | string[]>; score: number } | null = null

  for (const route of routes) {
    if (!route.page) continue
    const result = matchSegments(segmentsOf(route.urlPath), pathSegments)
    if (!result) continue
    if (!best || result.score > best.score) best = { route, params: result.params, score: result.score }
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
  for (let i = 0; i < es.length; i++) {
    const kind = segmentKind(es[i])
    // A trailing catch-all/optional catch-all is an ancestor of everything
    // under its prefix, regardless of how many segments remain.
    if (kind === 'catchAll' || kind === 'optionalCatchAll') return true
    if (i >= ps.length) return false
    if (kind === 'static' && es[i] !== ps[i]) return false
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

interface Location {
  pathname: string
  /** `location.search`-style query string (`''`, or starting with `?`). */
  search: string
}

/** Reads the current pathname + search off `window.location` (SSR-safe). */
function currentLocation(): Location {
  if (typeof window === 'undefined') return { pathname: '/', search: '' }
  return { pathname: window.location.pathname, search: window.location.search }
}

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
  const [location, setLocation] = useState(currentLocation)
  const [resolving, setResolving] = useState(() => !!middleware)
  const hopsRef = useRef(0)

  useEffect(() => {
    const onPopState = () => setLocation(currentLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const routerValue = useMemo(
    () => ({
      pathname: location.pathname,
      search: location.search,
      push(to: string) {
        window.history.pushState(null, '', to)
        setLocation(currentLocation())
      },
      replace(to: string) {
        window.history.replaceState(null, '', to)
        setLocation(currentLocation())
      },
      back() {
        window.history.back()
      },
    }),
    [location],
  )

  // Runs `middleware` before every navigation, ahead of matching/rendering.
  // No-op (and no async gate) when there's no `middleware` prop. Keyed off
  // the pathname only (like route matching below) — a query-only change
  // updates `routerValue`/`useSearchParams()` without re-running middleware.
  useEffect(() => {
    const { pathname, search } = location
    if (!middleware) {
      setResolving(false)
      return
    }

    let cancelled = false
    setResolving(true)

    Promise.resolve(middleware({ pathname, search }))
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
          setLocation(currentLocation())
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
  }, [middleware, location.pathname])

  const match = useMemo(() => matchRoute(routes, location.pathname), [routes, location.pathname])

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
  let params: Record<string, string | string[]> = {}

  // While `middleware` is deciding (or mid-redirect), render nothing rather
  // than flashing the requested route.
  if (!resolving) {
    if (!match) {
      const NotFound = nearestNotFound(routes, location.pathname)?.default ?? DefaultNotFound
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
