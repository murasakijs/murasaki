import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Connect, Plugin } from 'vite'

const RUNTIME_COOKIE = 'murasaki_runtime'
const PRIVILEGED_PREFIXES = ['/api/', '/__murasaki/']
let resolvedRuntimeToken: string | undefined

/** One private token shared by dev middleware and the native parent process. */
export function runtimeToken(): string {
  if (resolvedRuntimeToken) return resolvedRuntimeToken
  const inherited = process.env.MURASAKI_RUNTIME_TOKEN
  resolvedRuntimeToken = inherited && /^[0-9a-fA-F]{64}$/.test(inherited)
    ? inherited
    : randomBytes(32).toString('hex')
  return resolvedRuntimeToken
}

/** Protects dev's loopback actions/API/updater endpoints with an app session. */
export function runtimeSecurityPlugin(): Plugin {
  const token = runtimeToken()
  return {
    name: 'murasaki:runtime-security',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '/').split('?')[0]
        const privileged = PRIVILEGED_PREFIXES.some((prefix) => pathname.startsWith(prefix))

        if (privileged && !isAuthorizedRuntimeRequest(req, token)) {
          res.statusCode = 403
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ error: 'forbidden runtime request' }))
          return
        }

        // The initial document response installs an HttpOnly same-site
        // session before any renderer script can call a privileged endpoint.
        const acceptsHtml = req.headers.accept?.includes('text/html') ?? false
        if (!privileged && req.method === 'GET' && acceptsHtml) {
          res.setHeader(
            'set-cookie',
            `${RUNTIME_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
          )
          res.setHeader('x-content-type-options', 'nosniff')
          res.setHeader('referrer-policy', 'no-referrer')
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
  if (!isAuthorizedRuntimeRequest(req, expectedToken)) return false
  const nativeToken = req.headers['x-murasaki-native-token']
  if (typeof nativeToken !== 'string') return false
  const received = Buffer.from(nativeToken)
  const expected = Buffer.from(expectedToken)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export function isAuthorizedRuntimeRequest(req: Connect.IncomingMessage, expectedToken: string): boolean {
  const host = req.headers.host
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin !== undefined && origin !== `http://${host}`) return false

  const token = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${RUNTIME_COOKIE}=`))
    ?.slice(RUNTIME_COOKIE.length + 1)
  if (!token) return false
  const received = Buffer.from(token)
  const expected = Buffer.from(expectedToken)
  return received.length === expected.length && timingSafeEqual(received, expected)
}
