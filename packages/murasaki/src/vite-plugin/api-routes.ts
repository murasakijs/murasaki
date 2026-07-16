import type { Connect, Plugin, ViteDevServer } from 'vite'
import { readdir } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

interface Options {
  srcDir: string
}

const API_PATH_PREFIX = '/api/'
const ROUTE_FILE_NAMES = ['route.ts', 'route.js', 'route.mjs', 'route.mts']
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

/** Handler shape a `src/api/**\/route.ts` module exports, one per HTTP method. */
export type RouteHandler = (
  request: Request,
  context: { params: RouteParams },
) => Response | Promise<Response>

export type RouteParams = Record<string, string | string[] | undefined>
export type ApiRouteParamKind = 'dynamic' | 'catchAll' | 'optionalCatchAll'

export interface ApiRouteSource {
  /** URL pattern, e.g. `/api/users/:id` — same `:name` convention as file routing (vite-plugin/routing.ts). */
  pattern: string
  paramNames: string[]
  paramKinds: ApiRouteParamKind[]
  /** Higher values match before less-specific dynamic/catch-all routes. */
  specificity: number
  /** Regex source (no flags) matching a request pathname and capturing param values in declaration order. */
  regexSource: string
  /** Absolute path to the route.ts module. */
  filePath: string
}

export interface ApiRouteMatch {
  route: ApiRouteSource
  params: RouteParams
}

/**
 * File-based API routing over `src/api/**\/route.ts`.
 *
 * Mirrors Next's dynamic segment convention (`[name]`, `[...name]`, and
 * `[[...name]]`) but, unlike the
 * page router, compiles each entry to a regex: the prod counterpart
 * (cli/build-server.ts) has to bake the route table into a generated module
 * ahead of time, and a regex source string serializes into that module
 * trivially (`new RegExp(source)` at runtime) where a closure-based matcher
 * wouldn't.
 */
export async function scanApiRoutes(apiDir: string): Promise<ApiRouteSource[]> {
  const acc: ApiRouteSource[] = []
  try {
    await walk(apiDir, [], acc)
  } catch {
    // src/api not present, or has no route.ts files — return empty.
  }
  return acc
}

async function walk(dir: string, segments: string[], acc: ApiRouteSource[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = new Map<string, string>()
  const subdirs: string[] = []
  for (const e of entries) {
    if (e.isDirectory()) subdirs.push(e.name)
    else files.set(e.name, join(dir, e.name))
  }

  const routeFile = ROUTE_FILE_NAMES.map((name) => files.get(name)).find((f) => f !== undefined)
  if (routeFile) acc.push(toRouteSource(segments, routeFile))

  for (const sub of subdirs) {
    await walk(join(dir, sub), [...segments, sub], acc)
  }
}

function toRouteSource(segments: string[], filePath: string): ApiRouteSource {
  const paramNames: string[] = []
  const paramKinds: ApiRouteParamKind[] = []
  const patternParts: string[] = []
  let regexSource = '^/api'
  let specificity = 0
  for (const seg of segments) {
    const optionalCatchAll = /^\[\[\.\.\.([^/\]]+)\]\]$/.exec(seg)
    const catchAll = /^\[\.\.\.([^/\]]+)\]$/.exec(seg)
    const dynamic = /^\[([^/\]]+)\]$/.exec(seg)
    if (optionalCatchAll) {
      const name = optionalCatchAll[1]
      paramNames.push(name)
      paramKinds.push('optionalCatchAll')
      patternParts.push(`:${name}?*`)
      regexSource += '(?:/(.*))?'
    } else if (catchAll) {
      const name = catchAll[1]
      paramNames.push(name)
      paramKinds.push('catchAll')
      patternParts.push(`:${name}*`)
      regexSource += '/(.+)'
      specificity += 1
    } else if (dynamic) {
      const name = seg.slice(1, -1)
      paramNames.push(name)
      paramKinds.push('dynamic')
      patternParts.push(`:${name}`)
      regexSource += '/([^/]+)'
      specificity += 10
    } else {
      patternParts.push(seg)
      regexSource += `/${escapeRegExp(seg)}`
      specificity += 100
    }
  }
  return {
    pattern: `/api/${patternParts.join('/')}`,
    paramNames,
    paramKinds,
    specificity,
    regexSource: `${regexSource}/?$`,
    filePath,
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Matches `pathname` against `routes`. Static segments win over dynamic ones
 * — same "more specific wins" tie-break as react/app-router.tsx's
 * `matchRoute` — via a score of how many literal (non-param) segments the
 * pattern has.
 */
export function matchApiRoute(routes: ApiRouteSource[], pathname: string): ApiRouteMatch | null {
  let best: { route: ApiRouteSource; params: RouteParams; score: number } | null = null
  for (const route of routes) {
    const match = new RegExp(route.regexSource).exec(pathname)
    if (!match) continue
    const params: RouteParams = {}
    route.paramNames.forEach((name, i) => {
      const value = match[i + 1]
      const kind = route.paramKinds[i] ?? 'dynamic'
      if (kind === 'optionalCatchAll' && (value === undefined || value === '')) return
      params[name] = kind === 'dynamic'
        ? decodeURIComponent(value ?? '')
        : (value ?? '').split('/').map((segment) => decodeURIComponent(segment))
    })
    const score = route.specificity
    if (!best || score > best.score) best = { route, params, score }
  }
  return best ? { route: best.route, params: best.params } : null
}

/**
 * Dev-time counterpart of `src/api/**\/route.ts` handlers: a middleware that
 * matches `/api/*` requests against the discovered route table, loads the
 * matched module via `ssrLoadModule` (like server-actions.ts does for
 * `'use server'` modules), and dispatches to the export named after the
 * request method. In prod this is played by the routes registry
 * (cli/build-server.ts's `dist/server/routes.mjs`) + assets/prod-server.mjs,
 * which mirror the request/response handling here as closely as possible.
 */
export function apiRoutesPlugin({ srcDir }: Options): Plugin {
  const apiDir = join(srcDir, 'api')
  return {
    name: 'murasaki:api-routes',
    configureServer(server) {
      server.middlewares.use(handleApiRequest(server, apiDir))
    },
  }
}

function handleApiRequest(server: ViteDevServer, apiDir: string): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/'
    const pathname = rawUrl.split('?')[0]
    if (!pathname.startsWith(API_PATH_PREFIX)) return next()

    // Re-scanned per request rather than cached/watched — the api dir is
    // small and this keeps dev routes accurate across add/edit/remove
    // without needing a watcher or dev-server restart.
    const routes = await scanApiRoutes(apiDir)
    const match = matchApiRoute(routes, pathname)
    if (!match) {
      // `/api/*` is reserved for API routes: terminate with 404 rather than
      // falling through to Vite (which would serve the SPA HTML fallback and
      // return 200). Mirrors assets/prod-server.mjs's `handleApiRoute`.
      res.statusCode = 404
      res.end()
      return
    }

    const method = (req.method ?? 'GET').toUpperCase() as HttpMethod
    try {
      const mod = await server.ssrLoadModule(match.route.filePath)
      const handler = mod[method]
      if (typeof handler !== 'function') {
        res.statusCode = 405
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: `no handler for ${method} ${pathname}` }))
        return
      }

      const request = await toWebRequest(req)
      const response: Response = await handler(request, { params: match.params })
      await sendWebResponse(res, response, method === 'HEAD')
    } catch (err) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: String((err as Error)?.message ?? err) }))
    }
  }
}

/** Node `IncomingMessage` → Web `Request`. Mirrored (not shared, since prod-server.mjs ships standalone) in assets/prod-server.mjs's `toWebRequest`. */
async function toWebRequest(req: Connect.IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  if (!hasBody) return new Request(url, { method, headers })

  // Node's fetch implementation requires `duplex: 'half'` for streamed
  // request bodies. Keeping the IncomingMessage as a stream avoids buffering
  // uploads in memory and lets route handlers consume multipart/large bodies
  // incrementally, just like a regular Node HTTP server.
  const init = {
    method,
    headers,
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' }
  return new Request(url, init)
}

/** Web `Response` → Node `ServerResponse`. Mirrored in assets/prod-server.mjs's `sendWebResponse`. */
async function sendWebResponse(
  res: ServerResponse,
  response: Response,
  headOnly = false,
): Promise<void> {
  res.statusCode = response.status
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    res.setHeader(key, value)
  })
  const setCookies = getSetCookie?.call(response.headers) ?? []
  if (setCookies.length > 0) res.setHeader('set-cookie', setCookies)

  if (headOnly || !response.body) {
    res.end()
    return
  }

  // `pipeline` preserves backpressure and cancels the Web stream if the
  // client disconnects. Buffering with response.arrayBuffer() would make
  // SSE and other indefinite/large responses impossible.
  await pipeline(Readable.fromWeb(response.body as never), res)
}
