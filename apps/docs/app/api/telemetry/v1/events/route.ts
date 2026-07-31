import { createHash } from 'node:crypto'
import { writeTelemetryAggregate } from '@/lib/telemetry-store'

export const runtime = 'nodejs'

const EVENTS = new Set(['create_completed', 'dev_started', 'bundle_completed'])
const PLATFORMS = new Set(['darwin', 'win32', 'linux'])
const ARCHES = new Set(['arm64', 'x64'])

interface TelemetryPayload {
  schema: number
  event: string
  anonymousId: string
  version: string
  platform: string
  arch: string
  occurredAt: string
}

export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return new Response(null, { status: 415 })
  }
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > 4_096) return new Response(null, { status: 413 })

  let payload: unknown
  try {
    payload = await readBoundedJson(request, 4_096)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!isValidPayload(payload)) return new Response(null, { status: 400 })

  // The random installation identifier is immediately one-way hashed. Request
  // headers (including IP and User-Agent) are deliberately never copied into
  // the application event or aggregate store.
  const anonymousHash = createHash('sha256').update(payload.anonymousId).digest('hex')
  const event = {
    schema: 1,
    event: payload.event,
    anonymousHash,
    version: payload.version,
    platform: payload.platform,
    arch: payload.arch,
    occurredAt: payload.occurredAt,
    receivedAt: new Date().toISOString(),
  }

  try {
    const persisted = writeTelemetryAggregate(event)
    if (!persisted) console.info('murasaki_telemetry_event', JSON.stringify(event))
  } catch (error) {
    console.error('murasaki_telemetry_aggregate_error', error instanceof Error ? error.message : error)
    return new Response(null, { status: 503 })
  }

  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store' },
  })
}

async function readBoundedJson(request: Request, limit: number): Promise<unknown> {
  if (!request.body) throw new Error('missing body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error('body too large')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(body))
}

function isValidPayload(value: unknown): value is TelemetryPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<TelemetryPayload>
  const occurredAt = typeof payload.occurredAt === 'string' ? Date.parse(payload.occurredAt) : Number.NaN
  return (
    payload.schema === 1 &&
    typeof payload.event === 'string' &&
    EVENTS.has(payload.event) &&
    typeof payload.anonymousId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.anonymousId,
    ) &&
    typeof payload.version === 'string' &&
    /^[0-9A-Za-z.+-]{1,64}$/.test(payload.version) &&
    typeof payload.platform === 'string' &&
    PLATFORMS.has(payload.platform) &&
    typeof payload.arch === 'string' &&
    ARCHES.has(payload.arch) &&
    Number.isFinite(occurredAt) &&
    Math.abs(Date.now() - occurredAt) <= 24 * 60 * 60 * 1_000
  )
}
