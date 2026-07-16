/**
 * Murasaki's versioned Server Action wire format.
 *
 * JSON is only the outer container. Values are encoded as a reference graph,
 * which keeps browser and production semantics identical for values JSON
 * cannot represent (and for cyclic object graphs).
 */

export const WIRE_VERSION = 1 as const
export const WIRE_CONTENT_TYPE = 'application/vnd.murasaki.wire+json; version=1'
export const MAX_WIRE_PAYLOAD_BYTES = 32 * 1024 * 1024

export type WireErrorCode =
  | 'WIRE_UNSUPPORTED_VALUE'
  | 'WIRE_INVALID_ENVELOPE'
  | 'WIRE_UNSUPPORTED_VERSION'
  | 'WIRE_INVALID_NODE'
  | 'WIRE_INVALID_REFERENCE'
  | 'WIRE_DUPLICATE_REFERENCE'
  | 'WIRE_INVALID_BASE64'
  | 'WIRE_PAYLOAD_TOO_LARGE'

export class WireCodecError extends Error {
  readonly code: WireErrorCode

  constructor(code: WireErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WireCodecError'
    this.code = code
  }
}

type WireNode = Record<string, unknown>
type WireEnvelope = { $murasakiWire: typeof WIRE_VERSION; value: unknown }

/** Encode an arbitrary supported value into a versioned JSON payload. */
export async function stringifyWire(
  value: unknown,
  maxBytes = MAX_WIRE_PAYLOAD_BYTES,
): Promise<string> {
  const ids = new Map<object, number>()
  let nextId = 1

  const encode = async (input: unknown): Promise<unknown> => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'undefined') return { $: 'undefined' }
    if (typeof input === 'bigint') return { $: 'bigint', value: input.toString() }
    if (typeof input === 'number') {
      if (Number.isNaN(input)) return { $: 'number', value: 'NaN' }
      if (input === Infinity) return { $: 'number', value: 'Infinity' }
      if (input === -Infinity) return { $: 'number', value: '-Infinity' }
      if (Object.is(input, -0)) return { $: 'number', value: '-0' }
      return input
    }
    if (typeof input === 'function' || typeof input === 'symbol') {
      throw unsupported(input)
    }

    const object = input as object
    const existing = ids.get(object)
    if (existing !== undefined) return { $: 'ref', id: existing }
    const id = nextId++
    ids.set(object, id)

    if (Array.isArray(input)) {
      return { $: 'array', id, value: await Promise.all(input.map(encode)) }
    }
    if (input instanceof Date) {
      return { $: 'date', id, value: await encode(input.getTime()) }
    }
    if (input instanceof Map) {
      const entries: unknown[] = []
      for (const [key, entryValue] of input) entries.push([await encode(key), await encode(entryValue)])
      return { $: 'map', id, value: entries }
    }
    if (input instanceof Set) {
      const values: unknown[] = []
      for (const entry of input) values.push(await encode(entry))
      return { $: 'set', id, value: values }
    }
    if (input instanceof ArrayBuffer) {
      return { $: 'arrayBuffer', id, value: bytesToBase64(new Uint8Array(input)) }
    }
    if (ArrayBuffer.isView(input)) {
      if (!(input.buffer instanceof ArrayBuffer)) throw unsupported(input)
      const ctor = input instanceof DataView ? 'DataView' : input.constructor.name
      return {
        $: 'typedArray',
        id,
        ctor,
        buffer: await encode(input.buffer),
        byteOffset: input.byteOffset,
        byteLength: input.byteLength,
      }
    }
    if (typeof FormData !== 'undefined' && input instanceof FormData) {
      const entries: unknown[] = []
      for (const [key, entryValue] of input.entries()) {
        entries.push([key, await encode(entryValue)])
      }
      return { $: 'formData', id, value: entries }
    }
    if (isFile(input)) {
      return {
        $: 'file',
        id,
        name: input.name,
        type: input.type,
        lastModified: input.lastModified,
        value: bytesToBase64(new Uint8Array(await input.arrayBuffer())),
      }
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      return {
        $: 'blob',
        id,
        type: input.type,
        value: bytesToBase64(new Uint8Array(await input.arrayBuffer())),
      }
    }
    if (input instanceof Error) {
      const props: Array<[string, unknown]> = []
      for (const key of Object.keys(input)) {
        if (key === 'cause') continue
        props.push([key, await encode((input as unknown as Record<string, unknown>)[key])])
      }
      return {
        $: 'error',
        id,
        name: input.name,
        message: input.message,
        stack: input.stack,
        hasCause: 'cause' in input,
        cause: 'cause' in input ? await encode(input.cause) : { $: 'undefined' },
        props,
      }
    }

    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) throw unsupported(input)
    rejectSymbolKeys(input)
    const props: Array<[string, unknown]> = []
    for (const key of Object.keys(input)) {
      props.push([key, await encode((input as Record<string, unknown>)[key])])
    }
    return { $: 'object', id, nullPrototype: prototype === null, props }
  }

  const envelope: WireEnvelope = { $murasakiWire: WIRE_VERSION, value: await encode(value) }
  const text = JSON.stringify(envelope)
  assertPayloadSize(text, maxBytes)
  return text
}

/** Decode a payload produced by stringifyWire. */
export function parseWire(text: string, maxBytes = MAX_WIRE_PAYLOAD_BYTES): unknown {
  assertPayloadSize(text, maxBytes)
  let envelope: unknown
  try {
    envelope = JSON.parse(text)
  } catch (cause) {
    throw new WireCodecError('WIRE_INVALID_ENVELOPE', 'Invalid Murasaki wire JSON', { cause })
  }
  if (!isRecord(envelope) || !('$murasakiWire' in envelope) || !('value' in envelope)) {
    throw new WireCodecError('WIRE_INVALID_ENVELOPE', 'Missing Murasaki wire envelope')
  }
  if (envelope.$murasakiWire !== WIRE_VERSION) {
    throw new WireCodecError(
      'WIRE_UNSUPPORTED_VERSION',
      `Unsupported Murasaki wire version: ${String(envelope.$murasakiWire)}`,
    )
  }

  const refs = new Map<number, unknown>()
  const register = <T>(node: WireNode, value: T): T => {
    const id = requireId(node)
    if (refs.has(id)) {
      throw new WireCodecError('WIRE_DUPLICATE_REFERENCE', `Duplicate wire reference id: ${id}`)
    }
    refs.set(id, value)
    return value
  }

  const decode = (encoded: unknown): unknown => {
    if (encoded === null || typeof encoded === 'string' || typeof encoded === 'boolean') return encoded
    if (typeof encoded === 'number') return encoded
    if (!isRecord(encoded) || typeof encoded.$ !== 'string') invalidNode()
    const node = encoded as WireNode
    switch (node.$) {
      case 'undefined': return undefined
      case 'bigint': {
        if (typeof node.value !== 'string' || !/^-?\d+$/.test(node.value)) invalidNode()
        try { return BigInt(node.value) } catch { return invalidNode() }
      }
      case 'number':
        if (node.value === 'NaN') return NaN
        if (node.value === 'Infinity') return Infinity
        if (node.value === '-Infinity') return -Infinity
        if (node.value === '-0') return -0
        return invalidNode()
      case 'ref': {
        const id = requireId(node)
        if (!refs.has(id)) {
          throw new WireCodecError('WIRE_INVALID_REFERENCE', `Unknown wire reference id: ${id}`)
        }
        return refs.get(id)
      }
      case 'array': {
        if (!Array.isArray(node.value)) invalidNode()
        const output = register(node, [] as unknown[])
        for (const value of node.value) output.push(decode(value))
        return output
      }
      case 'date': {
        const output = register(node, new Date(0))
        const millis = decode(node.value)
        if (typeof millis !== 'number') invalidNode()
        output.setTime(millis)
        return output
      }
      case 'map': {
        if (!Array.isArray(node.value)) invalidNode()
        const output = register(node, new Map<unknown, unknown>())
        for (const entry of node.value) {
          if (!Array.isArray(entry) || entry.length !== 2) invalidNode()
          output.set(decode(entry[0]), decode(entry[1]))
        }
        return output
      }
      case 'set': {
        if (!Array.isArray(node.value)) invalidNode()
        const output = register(node, new Set<unknown>())
        for (const value of node.value) output.add(decode(value))
        return output
      }
      case 'arrayBuffer': {
        const bytes = base64ToBytes(requireString(node.value))
        return register(node, toArrayBuffer(bytes))
      }
      case 'typedArray': {
        const ctorName = requireString(node.ctor)
        const buffer = decode(node.buffer)
        if (!(buffer instanceof ArrayBuffer)) invalidNode()
        const byteOffset = requireNonNegativeInteger(node.byteOffset)
        const byteLength = requireNonNegativeInteger(node.byteLength)
        return register(node, makeTypedArray(ctorName, buffer, byteOffset, byteLength))
      }
      case 'blob': {
        const blob = new Blob([toArrayBuffer(base64ToBytes(requireString(node.value)))], {
          type: requireString(node.type),
        })
        return register(node, blob)
      }
      case 'file': {
        const bytes = base64ToBytes(requireString(node.value))
        const name = requireString(node.name)
        const type = requireString(node.type)
        const lastModified = requireFiniteNumber(node.lastModified)
        return register(node, createFile(bytes, name, type, lastModified))
      }
      case 'formData': {
        if (!Array.isArray(node.value)) invalidNode()
        const output = register(node, new FormData())
        for (const entry of node.value) {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') invalidNode()
          const value = decode(entry[1])
          if (typeof value === 'string') output.append(entry[0], value)
          else if (value instanceof Blob) output.append(entry[0], value, isFile(value) ? value.name : undefined)
          else invalidNode()
        }
        return output
      }
      case 'error': {
        const name = requireString(node.name)
        const output = register(node, createError(name, requireString(node.message)))
        output.name = name
        if (node.stack !== undefined) output.stack = requireString(node.stack)
        if (typeof node.hasCause !== 'boolean') invalidNode()
        if (node.hasCause) Object.defineProperty(output, 'cause', {
          value: decode(node.cause), writable: true, configurable: true, enumerable: false,
        })
        applyProps(output as unknown as Record<string, unknown>, node.props, decode)
        return output
      }
      case 'object': {
        if (typeof node.nullPrototype !== 'boolean') invalidNode()
        const output = register(
          node,
          (node.nullPrototype ? Object.create(null) : {}) as Record<string, unknown>,
        )
        applyProps(output, node.props, decode)
        return output
      }
      default: return invalidNode()
    }
  }

  return decode(envelope.value)
}

function unsupported(value: unknown): WireCodecError {
  const ctor = value && typeof value === 'object' ? value.constructor?.name : typeof value
  return new WireCodecError('WIRE_UNSUPPORTED_VALUE', `Unsupported wire value: ${ctor ?? 'unknown'}`)
}

function rejectSymbolKeys(value: object): void {
  if (Object.getOwnPropertySymbols(value).length > 0) throw unsupported(value)
}

function assertPayloadSize(text: string, maxBytes: number): void {
  const size = new TextEncoder().encode(text).byteLength
  if (size > maxBytes) {
    throw new WireCodecError(
      'WIRE_PAYLOAD_TOO_LARGE',
      `Murasaki wire payload exceeds ${maxBytes} bytes`,
    )
  }
}

function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File
}

function createFile(bytes: Uint8Array, name: string, type: string, lastModified: number): File | Blob {
  const buffer = toArrayBuffer(bytes)
  if (typeof File !== 'undefined') return new File([buffer], name, { type, lastModified })
  const blob = new Blob([buffer], { type })
  Object.defineProperties(blob, {
    name: { value: name, enumerable: true },
    lastModified: { value: lastModified, enumerable: true },
  })
  return blob
}

function createError(name: string, message: string): Error {
  const constructors: Record<string, new (message?: string) => Error> = {
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,
  }
  const ErrorConstructor = constructors[name] ?? Error
  return new ErrorConstructor(message)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new WireCodecError('WIRE_INVALID_BASE64', 'Invalid base64 in Murasaki wire payload')
  }
  let binary: string
  try { binary = atob(value) } catch (cause) {
    throw new WireCodecError('WIRE_INVALID_BASE64', 'Invalid base64 in Murasaki wire payload', { cause })
  }
  const output = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) output[index] = binary.charCodeAt(index)
  return output
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength)
  output.set(bytes)
  return output.buffer
}

function makeTypedArray(
  name: string,
  buffer: ArrayBuffer,
  byteOffset: number,
  byteLength: number,
): ArrayBufferView {
  const constructors: Record<string, (value: ArrayBuffer, offset: number, length: number) => ArrayBufferView> = {
    DataView: (value, offset, length) => new DataView(value, offset, length),
    Int8Array: (value, offset, length) => new Int8Array(value, offset, length),
    Uint8Array: (value, offset, length) => new Uint8Array(value, offset, length),
    Uint8ClampedArray: (value, offset, length) => new Uint8ClampedArray(value, offset, length),
    Int16Array: (value, offset, length) => new Int16Array(value, offset, length / 2),
    Uint16Array: (value, offset, length) => new Uint16Array(value, offset, length / 2),
    Int32Array: (value, offset, length) => new Int32Array(value, offset, length / 4),
    Uint32Array: (value, offset, length) => new Uint32Array(value, offset, length / 4),
    Float32Array: (value, offset, length) => new Float32Array(value, offset, length / 4),
    Float64Array: (value, offset, length) => new Float64Array(value, offset, length / 8),
    BigInt64Array: (value, offset, length) => new BigInt64Array(value, offset, length / 8),
    BigUint64Array: (value, offset, length) => new BigUint64Array(value, offset, length / 8),
  }
  const create = constructors[name]
  if (!create) return invalidNode()
  if (byteOffset + byteLength > buffer.byteLength) return invalidNode()
  try {
    const view = create(buffer, byteOffset, byteLength)
    if (view.byteLength !== byteLength) return invalidNode()
    return view
  } catch { return invalidNode() }
}

function applyProps(
  target: Record<string, unknown>,
  props: unknown,
  decode: (value: unknown) => unknown,
): void {
  if (!Array.isArray(props)) invalidNode()
  for (const entry of props) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') invalidNode()
    Object.defineProperty(target, entry[0], {
      value: decode(entry[1]), enumerable: true, writable: true, configurable: true,
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireId(node: WireNode): number {
  if (!Number.isSafeInteger(node.id) || (node.id as number) <= 0) return invalidNode()
  return node.id as number
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') return invalidNode()
  return value
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalidNode()
  return value
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return invalidNode()
  return value as number
}

function invalidNode(): never {
  throw new WireCodecError('WIRE_INVALID_NODE', 'Invalid node in Murasaki wire payload')
}
