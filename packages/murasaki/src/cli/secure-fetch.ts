import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

export type SecureFetchOptions = {
  label: string
  maxBytes: number
  timeoutMs: number
}

function validateOptions(url: string, options: SecureFetchOptions): URL {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`murasaki: ${options.label} URL must be credential-free HTTPS`)
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new TypeError('secure fetch maxBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TypeError('secure fetch timeoutMs must be a positive safe integer')
  }
  return parsed
}

function enforceResponse(response: Response, options: SecureFetchOptions): number {
  if (!response.ok) {
    throw new Error(
      `murasaki: failed to fetch ${options.label} (${response.status} ${response.statusText})`,
    )
  }
  if (response.url) {
    const finalUrl = new URL(response.url)
    if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password) {
      throw new Error(
        `murasaki: ${options.label} redirected away from credential-free HTTPS`,
      )
    }
  }
  const header = response.headers.get('content-length')
  if (header === null) return 0
  const length = Number(header)
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`murasaki: ${options.label} returned an invalid content-length`)
  }
  if (length > options.maxBytes) {
    throw new Error(`murasaki: ${options.label} exceeds the ${options.maxBytes}-byte limit`)
  }
  return length
}

async function withTimeout<T>(
  options: SecureFetchOptions,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  timer.unref()
  try {
    return await operation(controller.signal)
  } catch (error) {
    if (timedOut) {
      throw new Error(`murasaki: ${options.label} timed out after ${options.timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Read a small HTTPS resource with redirect, timeout, and streamed size bounds. */
export async function fetchHttpsBytes(
  url: string,
  options: SecureFetchOptions,
): Promise<Buffer> {
  validateOptions(url, options)
  return withTimeout(options, async (signal) => {
    const response = await fetch(url, { redirect: 'follow', signal })
    enforceResponse(response, options)
    if (!response.body) return Buffer.alloc(0)

    const chunks: Buffer[] = []
    let received = 0
    const source = Readable.fromWeb(
      response.body as import('node:stream/web').ReadableStream<Uint8Array>,
    )
    for await (const chunk of source) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += bytes.length
      if (received > options.maxBytes) {
        throw new Error(`murasaki: ${options.label} exceeds the ${options.maxBytes}-byte limit`)
      }
      chunks.push(bytes)
    }
    return Buffer.concat(chunks, received)
  })
}

export async function fetchHttpsText(
  url: string,
  options: SecureFetchOptions,
): Promise<string> {
  return (await fetchHttpsBytes(url, options)).toString('utf8')
}

/** Stream a large HTTPS artifact to a new private file while hashing it. */
export async function downloadHttpsFile(
  url: string,
  destination: string,
  options: SecureFetchOptions,
): Promise<string> {
  validateOptions(url, options)
  // Claim the destination before doing network work. If `open` reports
  // EEXIST, this function never owned that path and must not fetch or remove it.
  const file = await open(destination, 'wx', 0o600)
  let completed = false
  try {
    return await withTimeout(options, async (signal) => {
      const response = await fetch(url, { redirect: 'follow', signal })
      enforceResponse(response, options)
      if (!response.body) throw new Error(`murasaki: ${options.label} response has no body`)

      let received = 0
      const hash = createHash('sha256')
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          if (received > options.maxBytes) {
            callback(new Error(`murasaki: ${options.label} exceeds the ${options.maxBytes}-byte limit`))
            return
          }
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      const source = Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream<Uint8Array>,
      )
      // The FileHandle-backed stream owns and closes the descriptor. Leaving
      // autoClose enabled is important: pipeline waits for `close` as part of
      // successful completion.
      await pipeline(source, meter, file.createWriteStream())
      completed = true
      return hash.digest('hex')
    })
  } finally {
    // When no stream was created (for example a fetch/response error), the
    // handle is still open. After a pipeline, close() is harmlessly rejected
    // because autoClose already released it.
    await file.close().catch(() => {})
    if (!completed) await rm(destination, { force: true }).catch(() => {})
  }
}

/** Hash a local file without buffering the complete artifact in memory. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
