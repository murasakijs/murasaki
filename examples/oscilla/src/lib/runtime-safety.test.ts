import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import { executeWebSocket } from '../backend/runtime.ts'
import { appendLogChunk, drainLogLines, type LogAccumulator } from './log-buffer.ts'
import { readBoundedResponseBody } from './net.ts'

test('buffers partial log lines until a newline arrives', () => {
  const accumulator: LogAccumulator = { partial: '', queue: [], dropped: 0 }
  appendLogChunk(accumulator, 'one\npart')
  assert.deepEqual(drainLogLines(accumulator), ['one'])
  appendLogChunk(accumulator, 'ial\ntwo\n')
  assert.deepEqual(drainLogLines(accumulator), ['partial', 'two'])
})

test('bounds queued log lines and reports drops', () => {
  const accumulator: LogAccumulator = { partial: '', queue: [], dropped: 0 }
  appendLogChunk(accumulator, '1\n2\n3\n4\n', 100, 2)
  assert.deepEqual(drainLogLines(accumulator), ['3', '4'])
  assert.equal(accumulator.dropped, 2)
})

test('streams a response within the byte limit', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('hello')); controller.close() } }))
  assert.equal(await readBoundedResponseBody(response, 5), 'hello')
})

test('cancels a streamed response that exceeds the byte limit', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('too large')) }, cancel() { cancelled = true } }))
  await assert.rejects(readBoundedResponseBody(response, 3), /exceeds 3 byte limit/)
  assert.equal(cancelled, true)
})

test('terminates a WebSocket when an upgraded peer never responds', async () => {
  let peer: import('node:stream').Duplex | undefined
  let resolvePeerEnded!: () => void
  const peerEnded = new Promise<void>((resolve) => { resolvePeerEnded = resolve })
  const server = createServer()
  server.on('upgrade', (request, socket) => {
    peer = socket
    socket.on('data', () => { /* consume frames without answering */ })
    socket.once('end', resolvePeerEnded)
    socket.once('close', resolvePeerEnded)
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `ws://127.0.0.1:${address.port}`
  try {
    await assert.rejects(
      executeWebSocket({
        id: 'timeout', name: 'Timeout', protocol: 'WebSocket', method: 'GET', url,
        headers: {}, body: '{}', environment: 'dev', baseUrl: url, variables: {},
      }, url, 'req_timeout', 40),
      /timed out after 40 ms/,
    )
    const closed = await Promise.race([
      peerEnded.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ])
    assert.equal(closed, true, 'the non-cooperating peer must observe transport shutdown')
  } finally {
    peer?.destroy()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
