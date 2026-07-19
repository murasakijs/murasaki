import test from 'node:test'
import assert from 'node:assert/strict'
import jitiFactory from 'jiti'

const jiti = jitiFactory(import.meta.url)

class FakeSocket extends EventTarget {
  static OPEN = 1
  static instances = []

  readyState = 0
  sent = []

  constructor(url) {
    super()
    this.url = url
    FakeSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  send(payload) {
    this.sent.push(JSON.parse(payload))
  }

  receive(payload) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }

  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
const stamp = (offset) => new Date(Date.UTC(2026, 6, 19, 0, 0, offset)).toISOString()
const workspace = (id, revision, offset) => ({
  version: 1,
  locale: 'en',
  selectedPageId: id,
  pages: [{ id, parentId: null, title: id, icon: '◇', tags: [], blocks: [], favorite: false, sample: false, updatedAt: stamp(offset) }],
  database: [],
  databaseView: 'table',
  sampleData: false,
  updatedAt: stamp(offset),
  revision,
  trash: [],
})

test('sync merges the initial handshake and accepts an equal-revision reconnect snapshot', async () => {
  FakeSocket.instances = []
  const states = []
  const received = []
  const realSetTimeout = globalThis.setTimeout
  globalThis.WebSocket = FakeSocket
  globalThis.window = {
    setTimeout(callback, delay) {
      if (delay === 2_000) queueMicrotask(callback)
      else realSetTimeout(callback, 0)
      return 1
    },
    clearTimeout() {},
  }

  const { connectSync } = await jiti.import('../src/lib/sync.ts')
  const session = connectSync('ws://test', 'room', '0123456789abcdef', (value) => received.push(value), (state) => states.push(state))
  session.publish(workspace('local', 0, 1))

  const first = FakeSocket.instances[0]
  first.open()
  assert.equal(first.sent[0].type, 'join')
  first.receive({ type: 'snapshot', revision: 4, workspace: workspace('remote', 4, 2) })
  await tick()

  assert.deepEqual(received.at(-1).pages.map((page) => page.id).sort(), ['local', 'remote'])
  assert.equal(first.sent.at(-1).type, 'workspace')
  assert.equal(first.sent.at(-1).baseRevision, 4)

  const converged = received.at(-1)
  first.receive({ type: 'snapshot', revision: 5, workspace: { ...converged, revision: 5 } })
  await tick()
  first.close()
  await tick()

  const second = FakeSocket.instances[1]
  second.open()
  second.receive({ type: 'snapshot', revision: 5, workspace: { ...converged, revision: 5 } })
  await tick()
  assert.equal(states.at(-1), 'connected')

  session.close()
  globalThis.setTimeout = realSetTimeout
})
