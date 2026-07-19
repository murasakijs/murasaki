import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorizedWindowLabel,
  backendResourceForRequest,
  DEFAULT_PERMISSIONS_POLICY,
  isAuthorizedNativeRequest,
} from '../dist/vite-plugin/runtime-security.js'
import {
  createWindowAuthInitScript,
  deriveWindowToken,
  isBackendCapabilityAllowed,
} from '../dist/runtime/window-auth.js'

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
