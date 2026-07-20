import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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
      // Resolved once here (not per request) rather than at plugin
      // construction, since it needs `server.config.root` — authoritative
      // only once Vite has merged inline/user/plugin config, which
      // configureServer runs after. This plugin only ever runs in dev
      // (`apply: 'serve'` above), so `resolveHeaderContentSecurityPolicy`
      // always resolves against DEFAULT_DEVELOPMENT_CSP (or the user's full
      // override, or `false` for the opt-out) — never the production policy.
      // If `security.csp` is unconfigured and the project's index.html
      // declares its own CSP meta tag, this resolves to `false`: the app
      // shell defers to that user-owned tag (see shell.ts), so emitting the
      // framework default here too would enforce both cumulatively.
      const indexHtmlPath = resolve(server.config.root, 'index.html')
      const indexHtml = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, 'utf8') : null
      const cspHeader = resolveHeaderContentSecurityPolicy(options.csp, 'serve', indexHtml)
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
