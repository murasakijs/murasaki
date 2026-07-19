import { createHmac, timingSafeEqual } from 'node:crypto'

export const WINDOW_LABEL_HEADER = 'x-murasaki-window-label'
export const WINDOW_GENERATION_HEADER = 'x-murasaki-window-generation'
export const WINDOW_TOKEN_HEADER = 'x-murasaki-window-token'
export const WINDOW_LABEL_QUERY = '__murasaki_window'
export const WINDOW_GENERATION_QUERY = '__murasaki_window_generation'
export const WINDOW_TOKEN_QUERY = '__murasaki_window_token'

const WINDOW_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const DOMAIN_SEPARATOR = 'murasaki-window-authority-v2\0'

type RuntimeRequest = {
  url?: string
  headers: Record<string, string | string[] | undefined>
}

/** Derive an unforgeable renderer identity without persisting another secret. */
export function deriveWindowToken(runtimeToken: string, label: string, generation = 1): string {
  if (!/^[0-9a-fA-F]{64}$/.test(runtimeToken)) {
    throw new TypeError('runtime token must be a 256-bit hexadecimal value')
  }
  if (!WINDOW_LABEL_RE.test(label)) throw new TypeError(`invalid window label: ${label}`)
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new TypeError('window generation must be a positive safe integer')
  }
  return createHmac('sha256', Buffer.from(runtimeToken, 'hex'))
    .update(DOMAIN_SEPARATOR)
    .update(label)
    .update('\0')
    .update(String(generation))
    .digest('hex')
}

/**
 * Authenticate a renderer request and return its native-assigned window label.
 * Query credentials are accepted only by callers that explicitly opt in (SSE
 * cannot set request headers); normal fetch/XHR requests must use headers.
 */
export function authenticateWindowRequest(
  req: RuntimeRequest,
  runtimeToken: string,
  allowQuery = false,
): string | null {
  let label = singleHeader(req.headers[WINDOW_LABEL_HEADER])
  let generation = singleHeader(req.headers[WINDOW_GENERATION_HEADER])
  let token = singleHeader(req.headers[WINDOW_TOKEN_HEADER])
  if ((!label || !generation || !token) && allowQuery) {
    const url = new URL(req.url ?? '/', 'http://murasaki.local')
    label = url.searchParams.get(WINDOW_LABEL_QUERY) ?? undefined
    generation = url.searchParams.get(WINDOW_GENERATION_QUERY) ?? undefined
    token = url.searchParams.get(WINDOW_TOKEN_QUERY) ?? undefined
  }
  const generationNumber = generation && /^\d{1,20}$/.test(generation) ? Number(generation) : 0
  if (!label || !Number.isSafeInteger(generationNumber) || generationNumber < 1
    || !token || !WINDOW_LABEL_RE.test(label) || !/^[0-9a-fA-F]{64}$/.test(token)) {
    return null
  }
  const expected = Buffer.from(deriveWindowToken(runtimeToken, label, generationNumber), 'hex')
  const received = Buffer.from(token, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected) ? label : null
}

/** Exact grants and a single trailing `*` prefix wildcard. */
export function isBackendCapabilityAllowed(grants: readonly string[], resource: string): boolean {
  return grants.some((grant) => grant === resource
    || (grant.endsWith('*') && resource.startsWith(grant.slice(0, -1))))
}

/**
 * Trusted document-start script. The token identifies this window; it is not
 * an app-wide bearer secret. A compromised renderer can act only with its own
 * allowlist and cannot mint another window label.
 */
export function createWindowAuthInitScript(
  runtimeToken: string,
  label: string,
  expectedOrigin: string,
): string {
  const generation = 1
  const token = deriveWindowToken(runtimeToken, label, generation)
  const origin = new URL(expectedOrigin)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== expectedOrigin) {
    throw new TypeError(`window auth origin must be an exact 127.0.0.1 HTTP origin: ${expectedOrigin}`)
  }
  return `(() => {
  const expectedOrigin = ${JSON.stringify(origin.origin)}
  if (globalThis.top !== globalThis || location.origin !== expectedOrigin) return
  const label = ${JSON.stringify(label)}
  const generation = ${generation}
  const token = ${JSON.stringify(token)}
  const privileged = (url) => url.origin === location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__murasaki/'))
  const attach = (headers) => {
    const next = new Headers(headers)
    next.set(${JSON.stringify(WINDOW_LABEL_HEADER)}, label)
    next.set(${JSON.stringify(WINDOW_GENERATION_HEADER)}, String(generation))
    next.set(${JSON.stringify(WINDOW_TOKEN_HEADER)}, token)
    return next
  }
  const rawFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init)
    if (!privileged(new URL(request.url, location.href))) return rawFetch(request)
    return rawFetch(new Request(request, { headers: attach(request.headers) }))
  }
  const NativeXHR = globalThis.XMLHttpRequest
  if (NativeXHR) {
    const open = NativeXHR.prototype.open
    const send = NativeXHR.prototype.send
    NativeXHR.prototype.open = function(method, url, ...rest) {
      this.__murasakiPrivileged = privileged(new URL(String(url), location.href))
      return open.call(this, method, url, ...rest)
    }
    NativeXHR.prototype.send = function(body) {
      if (this.__murasakiPrivileged) {
        this.setRequestHeader(${JSON.stringify(WINDOW_LABEL_HEADER)}, label)
        this.setRequestHeader(${JSON.stringify(WINDOW_GENERATION_HEADER)}, String(generation))
        this.setRequestHeader(${JSON.stringify(WINDOW_TOKEN_HEADER)}, token)
      }
      return send.call(this, body)
    }
  }
  const NativeEventSource = globalThis.EventSource
  if (NativeEventSource) {
    globalThis.EventSource = class MurasakiEventSource extends NativeEventSource {
      constructor(url, options) {
        const next = new URL(String(url), location.href)
        if (privileged(next)) {
          next.searchParams.set(${JSON.stringify(WINDOW_LABEL_QUERY)}, label)
          next.searchParams.set(${JSON.stringify(WINDOW_GENERATION_QUERY)}, String(generation))
          next.searchParams.set(${JSON.stringify(WINDOW_TOKEN_QUERY)}, token)
        }
        super(next.href, options)
      }
    }
  }
})()`
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}
