import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'
import {
  authenticateWindowRequest,
  isBackendCapabilityAllowed,
} from '../runtime/window-auth.js'
import { resolveHeaderContentSecurityPolicy } from './shell.js'

const PRIVILEGED_PREFIXES = ['/api/', '/__murasaki/']
const NATIVE_ONLY_PATHS = new Set([
  '/__murasaki/main/shutdown',
  '/__murasaki/main/second-instance',
  '/__murasaki/main/open-request',
  '/__murasaki/main/windows/commands',
  '/__murasaki/main/windows/result',
  '/__murasaki/main/windows/event',
])
export const DEFAULT_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()'
let resolvedRuntimeToken: string | undefined

type WindowAuthority = { label: string; backendCapabilities: readonly string[] }

/** One private token shared by dev middleware and the native parent process. */
export function runtimeToken(): string {
  if (resolvedRuntimeToken) return resolvedRuntimeToken
  const inherited = process.env.MURASAKI_RUNTIME_TOKEN
  resolvedRuntimeToken = inherited && /^[0-9a-fA-F]{64}$/.test(inherited)
    ? inherited
    : randomBytes(32).toString('hex')
  return resolvedRuntimeToken
}

export interface RuntimeSecurityOptions {
  /** Same `security.csp` value the app-shell plugin resolves the meta tag from — kept as one resolver (shell.ts's `resolveHeaderContentSecurityPolicy`) so dev's header and meta tag never drift. */
  csp?: string | false
}

/** Protect dev loopback endpoints with native-issued, per-window authority. */
export function runtimeSecurityPlugin(
  windows: readonly WindowAuthority[],
  options: RuntimeSecurityOptions = {},
): Plugin {
  const token = runtimeToken()
  const grants = new Map(windows.map((window) => [window.label, window.backendCapabilities]))
  return {
    name: 'murasaki:runtime-security',
    apply: 'serve',
    configureServer(server) {
      // `server.config.root` is authoritative only once Vite has merged
      // inline/user/plugin config, which configureServer runs after — so
      // this path is captured here rather than at plugin construction, even
      // though the root itself is stable for the life of the dev server.
      const indexHtmlPath = resolve(server.config.root, 'index.html')

      // When `security.csp` is explicitly configured (a string, or `false`
      // for the opt-out), the header never depends on index.html — resolve
      // it once here, with no per-request file IO. `indexHtml` is passed as
      // `null` because resolveHeaderContentSecurityPolicy only ever reads it
      // when `configured === undefined`, which isn't this branch.
      const staticCspHeader = options.csp === undefined
        ? undefined
        : resolveHeaderContentSecurityPolicy(options.csp, 'serve', null)

      // When `security.csp` is unconfigured, whether the header is suppressed
      // depends on whether index.html currently declares a user-owned CSP
      // meta tag (see shell.ts's applyContentSecurityPolicy/
      // resolveHeaderContentSecurityPolicy) — and index.html can change
      // mid-session: Vite live-reloads an edited index.html without
      // restarting the dev server (so configureServer never reruns), and the
      // meta-tag transform itself (appShellPlugin's transformIndexHtml)
      // already re-evaluates index.html on every request. This header must
      // therefore track the file live too, or the two delivery mechanisms
      // can drift out of sync mid-session until a restart. Cached by mtime so
      // a request against an unchanged file skips re-reading + re-scanning
      // it, while a request right after an edit still recomputes.
      // Keyed on mtime *and* size (both come free from the same stat call) —
      // size alone changes on almost every real edit (adding/removing a meta
      // tag changes the byte length), which keeps this correct even on
      // filesystems with coarse mtime resolution where two edits could land
      // in the same tick.
      let cachedStatKey: string | null | undefined
      let cachedCspHeader: string | false = false
      const currentCspHeader = (): string | false => {
        if (staticCspHeader !== undefined) return staticCspHeader
        let statKey: string | null
        try {
          const stat = statSync(indexHtmlPath)
          statKey = `${stat.mtimeMs}:${stat.size}`
        } catch {
          statKey = null
        }
        if (statKey === cachedStatKey) return cachedCspHeader
        const indexHtml = statKey === null ? null : readFileSync(indexHtmlPath, 'utf8')
        cachedStatKey = statKey
        cachedCspHeader = resolveHeaderContentSecurityPolicy(undefined, 'serve', indexHtml)
        return cachedCspHeader
      }

      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://murasaki.local').pathname
        const privileged = pathname === '/api'
          || PRIVILEGED_PREFIXES.some((prefix) => pathname.startsWith(prefix))

        if (privileged) {
          const resource = backendResourceForRequest(req.method ?? 'GET', req.url ?? '/')
          const native = isAuthorizedNativeRequest(req, token)
          const allowQuery = req.method === 'GET'
            && (req.headers.accept?.includes('text/event-stream') ?? false)
          const label = native ? null : authorizedWindowLabel(req, token, allowQuery)
          const allowed = native || (!!label
            && !!resource
            && !NATIVE_ONLY_PATHS.has(pathname)
            && isBackendCapabilityAllowed(grants.get(label) ?? [], resource))
          if (!allowed) {
            res.statusCode = 403
            res.setHeader('content-type', 'application/json')
            res.setHeader('cache-control', 'no-store')
            res.end(JSON.stringify({ error: 'forbidden runtime request' }))
            return
          }
        }

        // Static documents are intentionally public on loopback. Unlike the
        // previous cookie bootstrap they reveal no bearer credential, so an
        // arbitrary local HTTP client cannot escalate from GET / to Node RPC.
        const acceptsHtml = req.headers.accept?.includes('text/html') ?? false
        if (!privileged && req.method === 'GET' && acceptsHtml) {
          res.setHeader('x-content-type-options', 'nosniff')
          res.setHeader('referrer-policy', 'no-referrer')
          // Wry delegates browser permission prompts to the platform and some
          // backends grant media capture once the OS has consented. Until a
          // per-window native permission callback is available, deny these
          // high-impact Web APIs at the document boundary for every renderer.
          res.setHeader('permissions-policy', DEFAULT_PERMISSIONS_POLICY)
          // security.csp: false opts out of the header too, not just the meta
          // tag applyContentSecurityPolicy injects into the served HTML.
          const cspHeader = currentCspHeader()
          if (cspHeader !== false) res.setHeader('content-security-policy', cspHeader)
        }
        next()
      })
    },
  }
}

export function isAuthorizedNativeRequest(
  req: Connect.IncomingMessage,
  expectedToken: string,
): boolean {
  if (!hasTrustedLoopbackMetadata(req)) return false
  const nativeToken = req.headers['x-murasaki-native-token']
  if (typeof nativeToken !== 'string') return false
  return safeTokenEqual(nativeToken, expectedToken)
}

/** Authenticate only; authorization is performed against the returned label. */
export function authorizedWindowLabel(
  req: Connect.IncomingMessage,
  expectedToken: string,
  allowQuery = false,
): string | null {
  if (!hasTrustedLoopbackMetadata(req)) return null
  return authenticateWindowRequest(req, expectedToken, allowQuery)
}

/** Stable backend resource ID for the window allowlist. */
export function backendResourceForRequest(method: string, rawUrl: string): string | null {
  const url = new URL(rawUrl, 'http://murasaki.local')
  const pathname = url.pathname
  const upperMethod = method.toUpperCase()
  for (const [prefix, kind] of [
    ['/__murasaki/main/call/', 'main'],
    ['/__murasaki/action/', 'action'],
  ] as const) {
    if (!pathname.startsWith(prefix)) continue
    const rest = pathname.slice(prefix.length)
    const separator = rest.lastIndexOf('/')
    if (separator < 1) return null
    try {
      return `${kind}:${decodeURIComponent(rest.slice(0, separator))}#${rest.slice(separator + 1)}`
    } catch {
      return null
    }
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return `api:${upperMethod}:${pathname}`
  }
  if (pathname.startsWith('/__murasaki/update/')) return `updater:${pathname}`
  if (pathname === '/__murasaki/main/events') {
    return `events:${url.searchParams.get('channel') ?? '*'}`
  }
  if (pathname === '/__murasaki/diagnostics/renderer-error') return 'diagnostics:renderer-error'
  if (NATIVE_ONLY_PATHS.has(pathname)) return `native:${pathname}`
  return null
}

function hasTrustedLoopbackMetadata(req: Connect.IncomingMessage): boolean {
  const host = req.headers.host
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  return origin === undefined || origin === `http://${host}`
}

function safeTokenEqual(receivedToken: string, expectedToken: string): boolean {
  const received = Buffer.from(receivedToken)
  const expected = Buffer.from(expectedToken)
  return received.length === expected.length && timingSafeEqual(received, expected)
}
