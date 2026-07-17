import assert from 'node:assert/strict'
import test from 'node:test'

import { subscribeDownloads } from '../dist/react/downloads.js'
import { subscribeFileDrops } from '../dist/react/file-drop.js'

test('subscribeDownloads wraps started and completed CustomEvents behind one typed handler', (t) => {
  const fakeWindow = new EventTarget()
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  const events = []
  const unsubscribe = subscribeDownloads((event) => events.push(event))

  fakeWindow.dispatchEvent(new CustomEvent('murasaki:downloadstarted', {
    detail: { id: 'a1b2', url: 'https://example.com/file.zip', path: '/Users/x/Downloads/file.zip' },
  }))
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:downloadcompleted', {
    detail: { url: 'https://example.com/file.zip', path: '/Users/x/Downloads/file.zip', success: true },
  }))

  assert.deepEqual(events, [
    { type: 'started', id: 'a1b2', url: 'https://example.com/file.zip', path: '/Users/x/Downloads/file.zip' },
    { type: 'completed', url: 'https://example.com/file.zip', path: '/Users/x/Downloads/file.zip', success: true },
  ])

  unsubscribe()
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:downloadstarted', {
    detail: { id: 'ignored', url: 'https://example.com/other.zip', path: '/tmp/other.zip' },
  }))
  assert.equal(events.length, 2)
})

test('subscribeDownloads is a silent no-op outside the native renderer', () => {
  delete globalThis.window
  assert.doesNotThrow(() => subscribeDownloads(() => {})())
})

test('subscribeFileDrops wraps all four drag-drop CustomEvents behind one typed handler', (t) => {
  const fakeWindow = new EventTarget()
  globalThis.window = fakeWindow
  t.after(() => { delete globalThis.window })

  const events = []
  const unsubscribe = subscribeFileDrops((event) => events.push(event))

  fakeWindow.dispatchEvent(new CustomEvent('murasaki:dragenter', {
    detail: { paths: ['/tmp/a.txt'], x: 10, y: 20 },
  }))
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:dragover', { detail: { x: 11, y: 21 } }))
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:dragdrop', {
    detail: { paths: ['/tmp/a.txt', '/tmp/b.txt'], x: 12, y: 22 },
  }))
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:dragleave', { detail: {} }))

  assert.deepEqual(events, [
    { type: 'enter', paths: ['/tmp/a.txt'], x: 10, y: 20 },
    { type: 'over', x: 11, y: 21 },
    { type: 'drop', paths: ['/tmp/a.txt', '/tmp/b.txt'], x: 12, y: 22 },
    { type: 'leave' },
  ])

  unsubscribe()
  fakeWindow.dispatchEvent(new CustomEvent('murasaki:dragleave', { detail: {} }))
  assert.equal(events.length, 4)
})

test('subscribeFileDrops is a silent no-op outside the native renderer', () => {
  delete globalThis.window
  assert.doesNotThrow(() => subscribeFileDrops(() => {})())
})
