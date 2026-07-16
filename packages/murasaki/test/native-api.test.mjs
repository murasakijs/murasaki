import assert from 'node:assert/strict'
import test from 'node:test'

import {
  app,
  appWindow,
  clipboard,
  dialog,
  notification,
  shell,
  systemPermission,
  tray,
  windows,
} from '../dist/native/index.js'

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
        'window.getLabel': 'main',
        'window.list': [{
          label: 'main', primary: true, visible: true, focused: true,
          minimized: false, maximized: false,
        }],
        'window.isVisible': true,
        'window.isFocused': true,
        'window.isMaximized': false,
        'window.isMinimized': false,
        'systemPermission.status': 'notDetermined',
        'systemPermission.request': 'granted',
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

  await app.quit()
  assert.deepEqual(await dialog.openFile({ multiple: true }), ['/tmp/example.txt'])
  assert.equal(await clipboard.readText(), 'copied')
  await clipboard.writeText('next')
  await notification.show({ title: 'Ready' })
  await shell.openExternal('https://example.com')
  assert.equal(await systemPermission.status('camera'), 'notDetermined')
  assert.equal(await systemPermission.request('camera'), 'granted')
  assert.equal(await appWindow.getLabel(), 'main')
  await appWindow.setSize(900, 600)
  await appWindow.show()
  await appWindow.hide()
  await appWindow.focus()
  await appWindow.setAlwaysOnTop(true)
  assert.equal(await appWindow.isVisible(), true)
  assert.equal(await appWindow.isFocused(), true)
  assert.equal(await appWindow.isMaximized(), false)
  assert.equal(await appWindow.isMinimized(), false)
  await appWindow.close()
  await windows.open('settings')
  assert.deepEqual(await windows.list(), [{
    label: 'main', primary: true, visible: true, focused: true,
    minimized: false, maximized: false,
  }])
  await windows.show('settings')
  await windows.hide('settings')
  await windows.focus('settings')
  await windows.close('settings')
  await tray.create({ tooltip: 'Murasaki' })
  await tray.setTooltip('Ready')
  await tray.setIcon('/tmp/tray.png')
  await tray.setMenu([{ id: 'open', label: 'Open' }])
  let trayClick
  const stop = tray.onClick((event) => { trayClick = event })
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:trayclick', {
    detail: { button: 'left', double: false },
  }))
  stop()
  let trayMenuItem
  const stopMenu = tray.onMenuItem((id) => { trayMenuItem = id })
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:traymenuclick', { detail: 'open' }))
  stopMenu()
  await tray.remove()

  assert.deepEqual(calls.map(({ method }) => method), [
    'app.quit',
    'dialog.openFile',
    'clipboard.readText',
    'clipboard.writeText',
    'notification.show',
    'shell.openExternal',
    'systemPermission.status',
    'systemPermission.request',
    'window.getLabel',
    'window.setSize',
    'window.show',
    'window.hide',
    'window.focus',
    'window.setAlwaysOnTop',
    'window.isVisible',
    'window.isFocused',
    'window.isMaximized',
    'window.isMinimized',
    'window.close',
    'window.open',
    'window.list',
    'window.showOther',
    'window.hideOther',
    'window.focusOther',
    'window.closeOther',
    'tray.create',
    'tray.setTooltip',
    'tray.setIcon',
    'tray.setMenu',
    'tray.remove',
  ])
  assert.equal(calls[1].args.multiple, true)
  assert.equal(calls[3].args.text, 'next')
  assert.deepEqual(calls.find(({ method }) => method === 'window.open').args, { label: 'settings' })
  assert.equal(new Set(calls.map(({ requestId }) => requestId)).size, calls.length)
  assert.equal(calls.every(({ requestId }) => typeof requestId === 'string' && requestId.length > 0), true)
  assert.deepEqual(trayClick, { button: 'left', double: false })
  assert.equal(trayMenuItem, 'open')
  delete globalThis.window
})

test('renderer native API rejects outside the native webview', async () => {
  delete globalThis.window
  await assert.rejects(() => clipboard.readText(), /only available in the Murasaki renderer/)
})

test('renderer native API rejects malformed correlated responses and cleans up', async (t) => {
  const fakeWindow = new EventTarget()
  fakeWindow.setTimeout = setTimeout
  fakeWindow.clearTimeout = clearTimeout
  let removed = 0
  const remove = fakeWindow.removeEventListener.bind(fakeWindow)
  fakeWindow.removeEventListener = (type, listener, options) => {
    if (type === 'murasaki:nativeresponse') removed++
    return remove(type, listener, options)
  }
  fakeWindow.ipc = {
    postMessage(raw) {
      const { requestId } = JSON.parse(raw)
      queueMicrotask(() => fakeWindow.dispatchEvent(new CustomEvent('murasaki:nativeresponse', {
        detail: { requestId, response: { value: 'missing ok discriminator' } },
      })))
    },
  }
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(() => clipboard.readText(), /malformed response/)
  assert.equal(removed, 1)
})

test('renderer native API cleans up when postMessage throws synchronously', async (t) => {
  const fakeWindow = new EventTarget()
  fakeWindow.setTimeout = setTimeout
  fakeWindow.clearTimeout = clearTimeout
  let removed = 0
  const remove = fakeWindow.removeEventListener.bind(fakeWindow)
  fakeWindow.removeEventListener = (type, listener, options) => {
    if (type === 'murasaki:nativeresponse') removed++
    return remove(type, listener, options)
  }
  fakeWindow.ipc = {
    postMessage() {
      throw new Error('bridge write failed')
    },
  }
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  await assert.rejects(() => clipboard.readText(), /bridge write failed/)
  assert.equal(removed, 1)
})
