import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import {
  authorizedWindowLabel,
  backendResourceForRequest,
  DEFAULT_PERMISSIONS_POLICY,
  isAuthorizedNativeRequest,
  runtimeSecurityPlugin,
  runtimeToken,
} from '../dist/vite-plugin/runtime-security.js'
import {
  createWindowAuthInitScript,
  deriveWindowToken,
  isBackendCapabilityAllowed,
} from '../dist/runtime/window-auth.js'
import { DEFAULT_DEVELOPMENT_CSP } from '../dist/vite-plugin/shell.js'

const TOKEN = 'a'.repeat(64)

// A default project root with no index.html of its own, so runDevMiddleware's
// existing callers keep resolving the unstripped framework default CSP,
// exactly as they did before the header started reading index.html.
const defaultRoot = mkdtempSync(join(tmpdir(), 'murasaki-runtime-security-'))
after(() => rmSync(defaultRoot, { recursive: true, force: true }))

test('renderer Web API permissions fail closed by default', () => {
  assert.equal(DEFAULT_PERMISSIONS_POLICY, 'camera=(), microphone=(), geolocation=()')
})

function request(headers = {}, url = '/') {
  return { headers, url }
}

test('authenticates a same-origin renderer as exactly its native-issued window label', () => {
  const headers = {
    host: 'localhost:5178',
    origin: 'http://localhost:5178',
    'sec-fetch-site': 'same-origin',
    'x-murasaki-window-label': 'preview',
    'x-murasaki-window-generation': '1',
    'x-murasaki-window-token': deriveWindowToken(TOKEN, 'preview'),
  }
  assert.equal(authorizedWindowLabel(request(headers), TOKEN), 'preview')
  assert.equal(authorizedWindowLabel(request({ ...headers, 'x-murasaki-window-label': 'main' }), TOKEN), null)
  assert.equal(authorizedWindowLabel(request({ ...headers, host: 'evil.test:5178' }), TOKEN), null)
  assert.equal(authorizedWindowLabel(request({ ...headers, origin: 'https://evil.test' }), TOKEN), null)
  assert.equal(authorizedWindowLabel(request({ ...headers, 'sec-fetch-site': 'cross-site' }), TOKEN), null)
})

test('an unauthenticated document GET cannot recover the runtime bearer secret', () => {
  const script = createWindowAuthInitScript(TOKEN, 'main', 'http://127.0.0.1:5178')
  assert.match(script, /x-murasaki-window-label/)
  assert.match(script, /x-murasaki-window-generation/)
  assert.match(script, /x-murasaki-window-token/)
  assert.match(script, /globalThis\.top !== globalThis/)
  assert.match(script, /location\.origin !== expectedOrigin/)
  assert.ok(script.indexOf('globalThis.top') < script.indexOf('const label'))
  assert.doesNotMatch(script, new RegExp(TOKEN))
  assert.equal(deriveWindowToken(TOKEN, 'main').length, 64)
  assert.notEqual(deriveWindowToken(TOKEN, 'main'), deriveWindowToken(TOKEN, 'preview'))
  assert.notEqual(deriveWindowToken(TOKEN, 'main', 1), deriveWindowToken(TOKEN, 'main', 2))
  assert.throws(
    () => createWindowAuthInitScript(TOKEN, 'main', 'https://evil.test'),
    /exact 127\.0\.0\.1 HTTP origin/,
  )
})

test('native control requests require the separate private native header', () => {
  const base = { host: '127.0.0.1:5178' }
  assert.equal(isAuthorizedNativeRequest(request({
    ...base,
    'x-murasaki-native-token': TOKEN,
  }), TOKEN), true)
  assert.equal(isAuthorizedNativeRequest(request(base), TOKEN), false)
  assert.equal(isAuthorizedNativeRequest(request({
    ...base,
    'x-murasaki-native-token': 'b'.repeat(64),
  }), TOKEN), false)
})

/** Extracts the plugin's dev middleware and runs it against a fake req/res pair. */
function runDevMiddleware(options, req, root = defaultRoot) {
  let middleware
  const plugin = runtimeSecurityPlugin([], options)
  plugin.configureServer({
    config: { root },
    middlewares: { use: (fn) => { middleware = fn } },
  })
  const headers = {}
  let nextCalled = false
  const res = {
    statusCode: 200,
    setHeader: (name, value) => { headers[name.toLowerCase()] = value },
    end: () => {},
  }
  middleware(req, res, () => { nextCalled = true })
  return { res, headers, nextCalled }
}

function htmlGetRequest(url, extraHeaders = {}) {
  return { method: 'GET', url, headers: { accept: 'text/html', ...extraHeaders } }
}

test('dev middleware sets the development Content-Security-Policy header on HTML document GETs', () => {
  const { headers, nextCalled } = runDevMiddleware({}, htmlGetRequest('/'))
  assert.equal(headers['content-security-policy'], DEFAULT_DEVELOPMENT_CSP)
  assert.equal(nextCalled, true)
})

test('dev middleware omits the CSP header on privileged and non-HTML requests', () => {
  // Unauthenticated: rejected (403) before the CSP-setting code even runs.
  const privileged = runDevMiddleware({}, htmlGetRequest('/api/items'))
  assert.equal(privileged.res.statusCode, 403)
  assert.equal(privileged.headers['content-security-policy'], undefined)

  // Authenticated as native: request is allowed through (next() called), but
  // privileged loopback endpoints still never get the document CSP header.
  const authorizedPrivileged = runDevMiddleware({}, htmlGetRequest('/api/items', {
    host: '127.0.0.1:5178',
    'x-murasaki-native-token': runtimeToken(),
  }))
  assert.equal(authorizedPrivileged.nextCalled, true)
  assert.equal(authorizedPrivileged.headers['content-security-policy'], undefined)

  const jsonRequest = { method: 'GET', url: '/main.js', headers: { accept: 'application/javascript' } }
  const { headers } = runDevMiddleware({}, jsonRequest)
  assert.equal(headers['content-security-policy'], undefined)
})

test('dev middleware suppresses the CSP header when security.csp is false', () => {
  const { headers } = runDevMiddleware({ csp: false }, htmlGetRequest('/'))
  assert.equal(headers['content-security-policy'], undefined)
  assert.equal(headers['permissions-policy'], DEFAULT_PERMISSIONS_POLICY)
})

test('dev middleware emits a user-supplied CSP override byte-identical to the configured string', () => {
  const custom = "default-src 'none'; connect-src https://api.example.test"
  const { headers } = runDevMiddleware({ csp: custom }, htmlGetRequest('/'))
  assert.equal(headers['content-security-policy'], custom)
})

test('dev middleware omits the CSP header entirely when deferring to a user-owned CSP meta tag in index.html', () => {
  const root = mkdtempSync(join(tmpdir(), 'murasaki-runtime-security-usermeta-'))
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><body></body></html>',
  )
  try {
    // The header would otherwise be enforced cumulatively alongside the
    // user's own meta CSP — suppress it so their policy stays authoritative.
    const { headers } = runDevMiddleware({}, htmlGetRequest('/'), root)
    assert.equal(headers['content-security-policy'], undefined)
    assert.equal(headers['permissions-policy'], DEFAULT_PERMISSIONS_POLICY)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dev middleware sets the full default CSP header when index.html has no CSP meta tag of its own', () => {
  const root = mkdtempSync(join(tmpdir(), 'murasaki-runtime-security-nometa-'))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><title>App</title></head><body></body></html>')
  try {
    const { headers } = runDevMiddleware({}, htmlGetRequest('/'), root)
    assert.equal(headers['content-security-policy'], DEFAULT_DEVELOPMENT_CSP)
    assert.match(DEFAULT_DEVELOPMENT_CSP, /frame-ancestors 'none'/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * Like `runDevMiddleware`, but calls `configureServer` ONCE and returns a
 * function to invoke the resulting middleware repeatedly against the SAME
 * instance — for exercising a live dev session across multiple requests
 * (e.g. index.html changing mid-session without a server restart).
 */
function startDevMiddleware(options, root) {
  let middleware
  const plugin = runtimeSecurityPlugin([], options)
  plugin.configureServer({
    config: { root },
    middlewares: { use: (fn) => { middleware = fn } },
  })
  return (req) => {
    const headers = {}
    let nextCalled = false
    const res = {
      statusCode: 200,
      setHeader: (name, value) => { headers[name.toLowerCase()] = value },
      end: () => {},
    }
    middleware(req, res, () => { nextCalled = true })
    return { res, headers, nextCalled }
  }
}

test('dev middleware CSP header tracks a live index.html edit within the same server session, not just at startup', () => {
  const root = mkdtempSync(join(tmpdir(), 'murasaki-runtime-security-live-edit-'))
  const indexHtmlPath = join(root, 'index.html')
  try {
    writeFileSync(indexHtmlPath, '<!doctype html><html><head><title>App</title></head><body></body></html>')
    // One middleware instance, built once — configureServer runs exactly
    // once here, exactly as it does for the life of a real dev server.
    const send = startDevMiddleware({}, root)

    // Request 1: no user CSP meta tag yet — the full default header.
    const first = send(htmlGetRequest('/'))
    assert.equal(first.headers['content-security-policy'], DEFAULT_DEVELOPMENT_CSP)

    // The user edits index.html mid-session — Vite live-reloads this without
    // restarting the dev server (so configureServer never reruns) — adding
    // their own CSP meta tag.
    writeFileSync(
      indexHtmlPath,
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><body></body></html>',
    )
    const second = send(htmlGetRequest('/'))
    assert.equal(second.headers['content-security-policy'], undefined)
    assert.equal(second.headers['permissions-policy'], DEFAULT_PERMISSIONS_POLICY)

    // Removing the tag again brings the default header back — this isn't a
    // one-way invalidation, it always mirrors the file's current content.
    writeFileSync(indexHtmlPath, '<!doctype html><html><head><title>App</title></head><body></body></html>')
    const third = send(htmlGetRequest('/'))
    assert.equal(third.headers['content-security-policy'], DEFAULT_DEVELOPMENT_CSP)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('backend authority resources are stable and grants are exact or trailing-prefix only', () => {
  const encoded = encodeURIComponent('src/backend/workspace.ts')
  assert.equal(
    backendResourceForRequest('POST', `/__murasaki/main/call/${encoded}/loadWorkspace`),
    'main:src/backend/workspace.ts#loadWorkspace',
  )
  assert.equal(backendResourceForRequest('POST', '/api/items/42'), 'api:POST:/api/items/42')
  assert.equal(isBackendCapabilityAllowed(['main:*'], 'main:src/backend/workspace.ts#loadWorkspace'), true)
  assert.equal(isBackendCapabilityAllowed([], 'main:src/backend/workspace.ts#loadWorkspace'), false)
  assert.equal(isBackendCapabilityAllowed(['api:GET:/api/items/*'], 'api:GET:/api/items/42'), true)
  assert.equal(isBackendCapabilityAllowed(['api:GET:/api/items/*'], 'api:POST:/api/items/42'), false)
})
