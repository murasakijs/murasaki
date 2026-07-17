import assert from 'node:assert/strict'
import test from 'node:test'

import { app, clipboard, dialog, notification, shell } from '../dist/native/index.js'

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

test('dialog.showMessage sends the exact options and returns the button result', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: 'ok' }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  const result = await dialog.showMessage({
    title: 'Confirm',
    message: 'Discard changes?',
    level: 'warning',
    buttons: 'okCancel',
  })

  assert.equal(result, 'ok')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'dialog.showMessage')
  assert.deepEqual(calls[0].args, {
    title: 'Confirm',
    message: 'Discard changes?',
    level: 'warning',
    buttons: 'okCancel',
  })
})

test('dialog.showMessage propagates a native rejection (e.g. invalid level/buttons)', async (t) => {
  const { fakeWindow } = fakeBridge(() => ({
    ok: false,
    error: { message: 'dialog.showMessage level must be info, warning, or error' },
  }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(
    () => dialog.showMessage({ message: 'hi', level: 'critical' }),
    /level must be/,
  )
})

test('clipboard.readImage returns the decoded image or null and sends no args', async (t) => {
  const image = { width: 2, height: 2, pngBase64: 'aGVsbG8=' }
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: image }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  assert.deepEqual(await clipboard.readImage(), image)
  assert.equal(calls[0].method, 'clipboard.readImage')
  assert.deepEqual(calls[0].args, {})

  const { fakeWindow: emptyWindow } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = emptyWindow
  assert.equal(await clipboard.readImage(), null)
})

test('clipboard.writeImage and writeHtml forward their exact payload shape', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await clipboard.writeImage({ pngBase64: 'aGVsbG8=' })
  await clipboard.writeHtml({ html: '<b>hi</b>', altText: 'hi' })

  assert.deepEqual(calls.map(({ method }) => method), ['clipboard.writeImage', 'clipboard.writeHtml'])
  assert.deepEqual(calls[0].args, { pngBase64: 'aGVsbG8=' })
  assert.deepEqual(calls[1].args, { html: '<b>hi</b>', altText: 'hi' })
})

test('clipboard.writeImage propagates a native rejection (e.g. oversized/invalid PNG)', async (t) => {
  const { fakeWindow } = fakeBridge(() => ({
    ok: false,
    error: { message: 'clipboard.writeImage pngBase64 is not valid base64' },
  }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(
    () => clipboard.writeImage({ pngBase64: 'not-base64!!' }),
    /not valid base64/,
  )
})

test('notification.show returns the generated id', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: '0123456789abcdef0123456789abcdef' }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  const id = await notification.show({ title: 'Ready' })
  assert.equal(id, '0123456789abcdef0123456789abcdef')
  assert.equal(calls[0].method, 'notification.show')
})

test('shell.trashItem and shell.openPath send { path } and resolve on success', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await shell.trashItem('/Users/example/Documents/old.txt')
  await shell.openPath('/Users/example/Documents/report.pdf')

  assert.deepEqual(calls.map(({ method }) => method), ['shell.trashItem', 'shell.openPath'])
  assert.deepEqual(calls[0].args, { path: '/Users/example/Documents/old.txt' })
  assert.deepEqual(calls[1].args, { path: '/Users/example/Documents/report.pdf' })
})

test('shell.openPath propagates a native rejection (e.g. URL or missing path)', async (t) => {
  const { fakeWindow } = fakeBridge(() => ({
    ok: false,
    error: { message: 'shell.openPath requires a filesystem path, not a URL' },
  }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(
    () => shell.openPath('https://evil.example'),
    /not a URL/,
  )
})

test('shell.runElevated sends { executable, args } and defaults args to []', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await shell.runElevated({ executable: 'C:/Program Files/App/updater.exe', args: ['--silent'] })
  await shell.runElevated({ executable: '/Applications/Tool.app/Contents/MacOS/tool' })

  assert.deepEqual(calls.map(({ method }) => method), ['shell.runElevated', 'shell.runElevated'])
  assert.deepEqual(calls[0].args, {
    executable: 'C:/Program Files/App/updater.exe',
    args: ['--silent'],
  })
  assert.deepEqual(calls[1].args, {
    executable: '/Applications/Tool.app/Contents/MacOS/tool',
    args: [],
  })
})

test('shell.runElevated rejects a relative, empty, or traversing executable before calling the bridge', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(
    () => shell.runElevated({ executable: 'relative/tool.exe' }),
    /absolute, non-traversing path/,
  )
  await assert.rejects(
    () => shell.runElevated({ executable: '' }),
    /absolute, non-traversing path/,
  )
  await assert.rejects(
    () => shell.runElevated({ executable: 'C:/Program Files/../System32/tool.exe' }),
    /absolute, non-traversing path/,
  )
  assert.equal(calls.length, 0)
})

test('shell.runElevated rejects too many or oversized arguments before calling the bridge', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: null }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(
    () => shell.runElevated({
      executable: '/Applications/Tool.app/Contents/MacOS/tool',
      args: Array.from({ length: 65 }, (_, index) => `arg${index}`),
    }),
    /at most 64 arguments/,
  )
  await assert.rejects(
    () => shell.runElevated({
      executable: '/Applications/Tool.app/Contents/MacOS/tool',
      args: ['a'.repeat(4097)],
    }),
    /at most 4096 UTF-8 bytes/,
  )
  assert.equal(calls.length, 0)
})

test('shell.runElevated propagates a native rejection (e.g. the user cancelled the UAC prompt)', async (t) => {
  const { fakeWindow } = fakeBridge(() => ({
    ok: false,
    error: { message: 'elevation was cancelled by the user' },
  }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(
    () => shell.runElevated({ executable: 'C:/Program Files/App/updater.exe' }),
    /elevation was cancelled by the user/,
  )
})

test('app.isElevated sends no args and resolves to the native boolean result', async (t) => {
  const { fakeWindow, calls } = fakeBridge(() => ({ ok: true, value: true }))
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  assert.equal(await app.isElevated(), true)
  assert.equal(calls[0].method, 'app.isElevated')
})
