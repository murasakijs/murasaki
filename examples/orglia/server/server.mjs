import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearSessionCookie, hashPassword, hashToken, newSessionToken, parseCookies, readSecret, sessionCookie, verifyPassword } from './auth.mjs'
import { executeCommand, CommandError } from './commands.mjs'
import { accountsFor, bootstrapData, tenantIds } from './sample-data.mjs'
import { openStore, RevisionConflictError } from './storage.mjs'

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }
const securityHeaders = {
  'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, { ...securityHeaders, ...extraHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

async function readBody(request) {
  const declaredLength = request.headers['content-length']
  if (typeof declaredLength === 'string'
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 256 * 1024)) {
    throw new CommandError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large')
  }
  const chunks = []; let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 256 * 1024) throw new CommandError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { throw new CommandError(400, 'INVALID_JSON', 'Invalid JSON') }
}

function normalizePublicOrigin(value) {
  if (value == null || value === '') return null
  let parsed
  try { parsed = new URL(value) }
  catch { throw new Error('ORGLIA_PUBLIC_ORIGIN must be an absolute http(s) origin') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('ORGLIA_PUBLIC_ORIGIN must contain only an http(s) scheme and host')
  }
  return parsed.origin
}

function requireSameOrigin(request, publicOrigin) {
  if (request.headers['x-orglia-request'] !== '1') throw new CommandError(403, 'CSRF_REJECTED', 'Missing request marker')
  const origin = request.headers.origin
  if (origin) {
    const expected = publicOrigin ?? `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`
    if (origin !== expected) throw new CommandError(403, 'CSRF_REJECTED', 'Cross-origin request rejected')
  }
  if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') throw new CommandError(403, 'CSRF_REJECTED', 'Cross-site request rejected')
}

function loginLimiter() {
  const attempts = new Map()
  const windowMs = 15 * 60_000
  const maxKeys = 4_096
  const prune = (now) => {
    for (const [key, value] of attempts) {
      if (now - value.startedAt > windowMs) attempts.delete(key)
    }
    while (attempts.size >= maxKeys) attempts.delete(attempts.keys().next().value)
  }
  return {
    check(key) {
      const now = Date.now(); const normalizedKey = String(key).slice(0, 256); const current = attempts.get(normalizedKey)
      if (!current || now - current.startedAt > windowMs) {
        if (!current) prune(now)
        attempts.set(normalizedKey, { startedAt: now, count: 1 })
        return true
      }
      current.count += 1
      return current.count <= 8
    },
    clear(key) { attempts.delete(String(key).slice(0, 256)) },
  }
}

async function resolveClientFile(clientDir, pathname) {
  let decoded
  try { decoded = decodeURIComponent(pathname) }
  catch { throw new CommandError(400, 'INVALID_PATH', 'Invalid URL path encoding') }

  const root = await realpath(clientDir)
  const candidate = resolve(root, `.${decoded}`)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new CommandError(403, 'FORBIDDEN', 'Forbidden')
  }

  let selected = candidate
  try { if (!(await stat(selected)).isFile()) selected = join(root, 'index.html') }
  catch { selected = join(root, 'index.html') }

  // `resolve()` prevents lexical traversal; `realpath()` also prevents a
  // symlink placed inside dist/client from exposing an arbitrary host file.
  const canonical = await realpath(selected)
  if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) {
    throw new CommandError(403, 'FORBIDDEN', 'Forbidden')
  }
  return canonical
}

async function envelope(store, tenantId) {
  const row = await store.read(tenantId)
  if (!row) return null
  return { data: { ...row.data, audit: await store.readAudit(tenantId) }, revision: row.revision }
}

function publicSession(auth, data) {
  const source = data.users.find((user) => user.id === auth.user_id && user.tenantId === auth.tenant_id)
  const tenant = data.tenants.find((item) => item.id === auth.tenant_id)
  if (!source || !tenant) return null
  return { user: { ...source, role: auth.role, email: auth.email }, tenant, expiresAt: new Date(auth.expires_at).toISOString() }
}

export function createOrgliaHandler({ store, clientDir = resolve('dist/client'), secureCookie, publicOrigin = process.env.ORGLIA_PUBLIC_ORIGIN }) {
  const limiter = loginLimiter()
  const trustedPublicOrigin = normalizePublicOrigin(publicOrigin)
  const cookieIsSecure = secureCookie ?? (trustedPublicOrigin?.startsWith('https://') || process.env.COOKIE_SECURE === '1')
  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      if (url.pathname === '/healthz') return sendJson(response, 200, { ok: true, database: store.kind })

      if (url.pathname === '/api/login' && request.method === 'POST') {
        requireSameOrigin(request, trustedPublicOrigin)
        const input = await readBody(request)
        const candidateEmail = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
        const email = candidateEmail.length <= 254 ? candidateEmail : ''
        // Scope failures to both the peer and account. A TLS-terminating proxy
        // can legitimately give many users one remote address; one bad login
        // must not lock every other account behind it.
        const key = `${String(request.socket.remoteAddress ?? 'unknown').slice(0, 128)}\0${email || '<invalid>'}`
        if (!limiter.check(key)) return sendJson(response, 429, { code: 'RATE_LIMITED', error: 'Too many login attempts' }, { 'retry-after': '900' })
        const account = email ? await store.findAccountByEmail(email) : null
        if (!account || typeof input.password !== 'string' || !await verifyPassword(input.password, account.password_hash)) return sendJson(response, 401, { code: 'INVALID_CREDENTIALS', error: 'Email or password is incorrect' })
        const token = newSessionToken(); const expiresAt = new Date(Date.now() + 8 * 60 * 60_000).toISOString()
        await store.createSession(hashToken(token), account.account_id, expiresAt); limiter.clear(key)
        const state = await envelope(store, account.tenant_id); const session = state && publicSession({ ...account, expires_at: expiresAt }, state.data)
        if (!state || !session) return sendJson(response, 403, { code: 'ACCOUNT_INVALID', error: 'Account is not linked to an active tenant user' })
        return sendJson(response, 200, { session, state }, { 'set-cookie': sessionCookie(token, { secure: cookieIsSecure }) })
      }

      const token = parseCookies(request.headers.cookie).orglia_session
      const auth = token ? await store.getSession(hashToken(token)) : null
      if (url.pathname.startsWith('/api/')) {
        if (!auth) return sendJson(response, 401, { code: 'UNAUTHENTICATED', error: 'Authentication required' })
        const state = await envelope(store, auth.tenant_id)
        const session = state && publicSession(auth, state.data)
        if (!state || !session) return sendJson(response, 403, { code: 'ACCOUNT_INVALID', error: 'Account is not linked to an active tenant user' })

        if (url.pathname === '/api/session' && request.method === 'GET') return sendJson(response, 200, { session, state })
        if (url.pathname === '/api/state' && request.method === 'GET') return sendJson(response, 200, state)
        if (url.pathname === '/api/logout' && request.method === 'POST') {
          requireSameOrigin(request, trustedPublicOrigin); await store.deleteSession(hashToken(token))
          return sendJson(response, 200, { ok: true }, { 'set-cookie': clearSessionCookie({ secure: cookieIsSecure }) })
        }
        if (url.pathname === '/api/commands' && request.method === 'POST') {
          requireSameOrigin(request, trustedPublicOrigin)
          const input = await readBody(request)
          if (!Number.isInteger(input.revision) || typeof input.type !== 'string') throw new CommandError(400, 'INVALID_COMMAND', 'revision and command type are required')
          const identity = { tenantId: auth.tenant_id, userId: auth.user_id, role: auth.role, name: session.user.name }
          await store.mutate(auth.tenant_id, input.revision, { userId: identity.userId, name: identity.name }, (data) => executeCommand(data, input, identity, { resetData: (withSample) => bootstrapData(auth.tenant_id, withSample) }))
          return sendJson(response, 200, await envelope(store, auth.tenant_id))
        }
        return sendJson(response, 404, { code: 'NOT_FOUND', error: 'API route not found' })
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' })
      const file = await resolveClientFile(clientDir, url.pathname)
      response.writeHead(200, { ...securityHeaders, 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' })
      if (request.method === 'HEAD') return response.end()
      createReadStream(file).pipe(response)
    } catch (error) {
      if (error instanceof RevisionConflictError) return sendJson(response, 409, { code: error.code, error: error.message, revision: error.revision })
      if (error instanceof CommandError) return sendJson(response, error.status, { code: error.code, error: error.message })
      process.stderr.write(`${error?.stack ?? error}\n`)
      return sendJson(response, 500, { code: 'INTERNAL_ERROR', error: 'Internal server error' })
    }
  }
}

export async function bootstrapServer(options = {}) {
  const store = options.store ?? await openStore(options)
  const password = options.bootstrapPassword ?? await readSecret('ORGLIA_BOOTSTRAP_PASSWORD', { developmentFallback: 'orglia-demo-change-me' })
  const passwordHash = await hashPassword(password)
  const withSample = options.withSample ?? process.env.NO_SAMPLE_DATA !== '1'
  const initialTenants = withSample ? tenantIds : [process.env.ORGLIA_BOOTSTRAP_TENANT_ID ?? tenantIds[0]]
  for (const tenantId of initialTenants) {
    const data = bootstrapData(tenantId, withSample)
    await store.initializeTenant(tenantId, data, accountsFor(data), passwordHash)
  }
  const handler = createOrgliaHandler({ store, clientDir: options.clientDir, secureCookie: options.secureCookie, publicOrigin: options.publicOrigin })
  return { store, server: createServer(handler), password }
}

async function main() {
  const { store, server } = await bootstrapServer()
  const port = Number(process.env.PORT ?? 4173)
  server.listen(port, '0.0.0.0', () => process.stdout.write(`Orglia listening on http://0.0.0.0:${port} (${store.kind})\n`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await store.close(); process.exit(0) }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
