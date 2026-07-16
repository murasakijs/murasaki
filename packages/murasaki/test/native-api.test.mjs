import assert from 'node:assert/strict'
import test from 'node:test'

import { appWindow, clipboard, dialog, notification, shell, tray } from '../dist/native/index.js'

test('renderer native API uses request-correlated bridge calls', async () => {
  const calls = []
  const fakeWindow = new EventTarget()
  fakeWindow.setTimeout = setTimeout
  fakeWindow.clearTimeout = clearTimeout
  fakeWindow.ipc = {
    postMessage(raw) {
      const call = JSON.parse(raw)
      calls.push(call)
      const values = {
        'dialog.openFile': ['/tmp/example.txt'],
        'clipboard.readText': 'copied',
      }
      queueMicrotask(() => fakeWindow.dispatchEvent(new CustomEvent('murasaki:nativeresponse', {
        detail: {
          requestId: call.requestId,
          response: { ok: true, value: values[call.method] ?? null },
        },
      })))
    },
  }
  globalThis.window = fakeWindow

  assert.deepEqual(await dialog.openFile({ multiple: true }), ['/tmp/example.txt'])
  assert.equal(await clipboard.readText(), 'copied')
  await clipboard.writeText('next')
  await notification.show({ title: 'Ready' })
  await shell.openExternal('https://example.com')
  await appWindow.setSize(900, 600)
  await tray.create({ tooltip: 'Murasaki' })
  await tray.setTooltip('Ready')
  let trayClick
  const stop = tray.onClick((event) => { trayClick = event })
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:trayclick', {
    detail: { button: 'left', double: false },
  }))
  stop()
  await tray.remove()

  assert.deepEqual(calls.map(({ method }) => method), [
    'dialog.openFile',
    'clipboard.readText',
    'clipboard.writeText',
    'notification.show',
    'shell.openExternal',
    'window.setSize',
    'tray.create',
    'tray.setTooltip',
    'tray.remove',
  ])
  assert.equal(calls[0].args.multiple, true)
  assert.equal(calls[2].args.text, 'next')
  assert.deepEqual(trayClick, { button: 'left', double: false })
  delete globalThis.window
})

test('renderer native API rejects outside the native webview', async () => {
  delete globalThis.window
  await assert.rejects(() => clipboard.readText(), /only available in the Murasaki renderer/)
})
