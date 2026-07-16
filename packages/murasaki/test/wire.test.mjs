import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseWire,
  stringifyWire,
  WireCodecError,
  WIRE_VERSION,
} from '../dist/runtime/wire.js'

test('wire codec round-trips rich values and cyclic identity', async () => {
  const shared = { label: 'shared' }
  const sharedBuffer = Uint8Array.from([10, 20, 30, 40, 50, 60]).buffer
  const root = {
    shared,
    again: shared,
    missing: undefined,
    date: new Date('2026-07-16T00:01:00.000Z'),
    bigint: 123456789012345678901234567890n,
    numbers: [NaN, Infinity, -Infinity, -0],
    map: new Map(),
    set: new Set(),
    buffer: Uint8Array.from([1, 2, 3, 255]).buffer,
    typed: new Uint16Array(sharedBuffer, 2, 2),
    typedBuffer: sharedBuffer,
    view: new DataView(Uint8Array.from([7, 8, 9]).buffer),
    blob: new Blob(['murasaki'], { type: 'text/plain' }),
    form: new FormData(),
    error: new Error('outer', { cause: new TypeError('inner') }),
  }
  root.self = root
  root.map.set(shared, root)
  root.set.add(root)
  root.error.code = 'E_MURASAKI'
  root.form.append('title', 'Murasaki')
  const file = typeof File === 'undefined'
    ? new Blob(['file-body'], { type: 'text/plain' })
    : new File(['file-body'], 'demo.txt', { type: 'text/plain', lastModified: 1234 })
  root.form.append('asset', file, 'demo.txt')

  const decoded = parseWire(await stringifyWire(root))
  assert.equal(decoded.self, decoded)
  assert.equal(decoded.shared, decoded.again)
  assert.equal(decoded.missing, undefined)
  assert.equal(decoded.date.toISOString(), '2026-07-16T00:01:00.000Z')
  assert.equal(decoded.bigint, root.bigint)
  assert.equal(Number.isNaN(decoded.numbers[0]), true)
  assert.equal(decoded.numbers[1], Infinity)
  assert.equal(decoded.numbers[2], -Infinity)
  assert.equal(Object.is(decoded.numbers[3], -0), true)
  assert.equal(decoded.map.get(decoded.shared), decoded)
  assert.equal(decoded.set.has(decoded), true)
  assert.deepEqual([...new Uint8Array(decoded.buffer)], [1, 2, 3, 255])
  assert.deepEqual([...new Uint8Array(decoded.typed.buffer, decoded.typed.byteOffset, decoded.typed.byteLength)], [30, 40, 50, 60])
  assert.equal(decoded.typed.buffer, decoded.typedBuffer)
  assert.equal(decoded.typed.byteOffset, 2)
  assert.deepEqual(
    Array.from({ length: decoded.view.byteLength }, (_, index) => decoded.view.getUint8(index)),
    [7, 8, 9],
  )
  assert.equal(await decoded.blob.text(), 'murasaki')
  assert.equal(decoded.blob.type, 'text/plain')
  assert.equal(decoded.form.get('title'), 'Murasaki')
  assert.equal(await decoded.form.get('asset').text(), 'file-body')
  assert.equal(decoded.form.get('asset').name, 'demo.txt')
  assert.equal(decoded.error instanceof Error, true)
  assert.equal(decoded.error.message, 'outer')
  assert.equal(decoded.error.cause instanceof Error, true)
  assert.equal(decoded.error.cause instanceof TypeError, true)
  assert.equal(decoded.error.cause.name, 'TypeError')
  assert.equal(decoded.error.cause.message, 'inner')
  assert.equal(decoded.error.code, 'E_MURASAKI')
})

test('wire codec rejects unsupported values and oversized payloads with stable codes', async () => {
  class Custom {}
  await assert.rejects(() => stringifyWire(new Custom()), (error) => {
    assert.equal(error instanceof WireCodecError, true)
    assert.equal(error.code, 'WIRE_UNSUPPORTED_VALUE')
    return true
  })
  await assert.rejects(() => stringifyWire('too large', 4), (error) => {
    assert.equal(error.code, 'WIRE_PAYLOAD_TOO_LARGE')
    return true
  })
})

test('wire decoder validates versions, references, duplicate ids, and base64', () => {
  const cases = [
    [{ $murasakiWire: WIRE_VERSION + 1, value: null }, 'WIRE_UNSUPPORTED_VERSION'],
    [{ $murasakiWire: WIRE_VERSION, value: { $: 'ref', id: 99 } }, 'WIRE_INVALID_REFERENCE'],
    [{
      $murasakiWire: WIRE_VERSION,
      value: { $: 'array', id: 1, value: [
        { $: 'object', id: 2, nullPrototype: false, props: [] },
        { $: 'object', id: 2, nullPrototype: false, props: [] },
      ] },
    }, 'WIRE_DUPLICATE_REFERENCE'],
    [{ $murasakiWire: WIRE_VERSION, value: { $: 'blob', id: 1, type: '', value: '%' } }, 'WIRE_INVALID_BASE64'],
  ]
  for (const [payload, code] of cases) {
    assert.throws(() => parseWire(JSON.stringify(payload)), (error) => {
      assert.equal(error instanceof WireCodecError, true)
      assert.equal(error.code, code)
      return true
    })
  }
})
