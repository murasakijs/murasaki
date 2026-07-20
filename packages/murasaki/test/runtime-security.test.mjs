import assert from 'node:assert/strict'
import test from 'node:test'
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
function runDevMiddleware(options, req) {
  let middleware
  const plugin = runtimeSecurityPlugin([], options)
  plugin.configureServer({ middlewares: { use: (fn) => { middleware = fn } } })
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
