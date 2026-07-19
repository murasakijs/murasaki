import assert from 'node:assert/strict'
import test from 'node:test'

import { webview } from '../dist/native/index.js'

function fakeBridge(values) {
  const calls = []
  const fakeWindow = new EventTarget()
  fakeWindow.setTimeout = setTimeout
  fakeWindow.clearTimeout = clearTimeout
  fakeWindow.ipc = {
    postMessage(raw) {
      const call = JSON.parse(raw)
      calls.push(call)
      const response = values(call)
      queueMicrotask(() => fakeWindow.dispatchEvent(new CustomEvent('murasaki:nativeresponse', {
        detail: { requestId: call.requestId, response },
      })))
    },
  }
  return { fakeWindow, calls }
}

test('webview.setZoom sends the exact factor and resolves', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await webview.setZoom(1.5)
  assert.equal(calls[0].method, 'webview.setZoom')
  assert.deepEqual(calls[0].args, { factor: 1.5 })
})

test('webview.setZoom propagates a native rejection (e.g. out-of-bounds factor)', async (t) => {
  const { fakeWindow } = fakeBridge(() => ({
    ok: false,
    error: { message: 'factor must be a finite number between 0.25 and 5.0' },
  }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(() => webview.setZoom(10), /between 0.25 and 5.0/)
})

test('webview.print sends no args and resolves', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await webview.print()
  assert.equal(calls[0].method, 'webview.print')
  assert.deepEqual(calls[0].args, {})
})

test('webview.getCookies forwards an optional url and returns the exact cookie list', async (t) => {
  const cookies = [{
    name: 'session_id', value: 'abc123', domain: 'example.com', path: '/',
    secure: true, httpOnly: true,
  }]
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: { cookies } }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  assert.deepEqual(await webview.getCookies({ url: 'https://example.com/' }), { cookies })
  assert.equal(calls[0].method, 'webview.getCookies')
  assert.deepEqual(calls[0].args, { url: 'https://example.com/' })

  const { fakeWindow: noUrlWindow, calls: noUrlCalls } = fakeBridge(() => ({
    ok: true,
    value: { cookies: [] },
  }))
  globalThis.window = noUrlWindow
  assert.deepEqual(await webview.getCookies(), { cookies: [] })
  assert.deepEqual(noUrlCalls[0].args, {})
})

test('webview.setCookie sends the exact payload shape', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await webview.setCookie({
    url: 'https://example.com/',
    name: 'session_id',
    value: 'abc123',
    secure: true,
    httpOnly: true,
    expiresAt: 1_700_000_000_000,
  })
  assert.equal(calls[0].method, 'webview.setCookie')
  assert.deepEqual(calls[0].args, {
    url: 'https://example.com/',
    name: 'session_id',
    value: 'abc123',
    secure: true,
    httpOnly: true,
    expiresAt: 1_700_000_000_000,
  })
})

test('webview.deleteCookie sends the exact payload shape', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await webview.deleteCookie({ url: 'https://example.com/', name: 'session_id' })
  assert.equal(calls[0].method, 'webview.deleteCookie')
  assert.deepEqual(calls[0].args, { url: 'https://example.com/', name: 'session_id' })
})

// The native host keeps the legacy murasaki runtime cookie name reserved
// (case-insensitively) as defense in depth — see
// `crates/native/src/webview.rs`'s `PROTECTED_SESSION_COOKIE_NAME` and its
// Rust unit tests. This asserts the TS wrapper faithfully surfaces that
// rejection rather than swallowing or reshaping it.
test('webview.setCookie/deleteCookie surface the reserved-runtime-cookie rejection', async (t) => {
  const rejection = {
    ok: false,
    error: { message: 'cannot modify the reserved murasaki runtime cookie' },
  }
  const { fakeWindow: setWindow } = fakeBridge(() => rejection)
  globalThis.window = setWindow
  await assert.rejects(
    () => webview.setCookie({ url: 'https://example.com/', name: 'murasaki_runtime', value: 'x' }),
    /reserved murasaki runtime cookie/,
  )

  const { fakeWindow: deleteWindow } = fakeBridge(() => rejection)
  globalThis.window = deleteWindow
  t.after(() => { delete globalThis.window })
  await assert.rejects(
    () => webview.deleteCookie({ url: 'https://example.com/', name: 'MURASAKI_RUNTIME' }),
    /reserved murasaki runtime cookie/,
  )
})
