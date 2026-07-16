import assert from 'node:assert/strict'
import test from 'node:test'

import { emitMainEvent, subscribeMainEvents } from '../dist/main/index.js'

test('main event bus publishes typed channel values and unsubscribes', () => {
  const received = []
  const unsubscribe = subscribeMainEvents((event) => received.push(event))
  emitMainEvent('relay.status', { connected: true })
  unsubscribe()
  emitMainEvent('relay.status', { connected: false })
  assert.deepEqual(received, [{ channel: 'relay.status', value: { connected: true } }])
  assert.throws(() => emitMainEvent('../unsafe', null), /safe identifier/)
})
