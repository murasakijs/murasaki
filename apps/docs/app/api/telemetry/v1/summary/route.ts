import { timingSafeEqual } from 'node:crypto'
import { readTelemetrySummary } from '@/lib/telemetry-store'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const adminToken = process.env.MURASAKI_TELEMETRY_ADMIN_TOKEN
  if (!adminToken) return Response.json({ error: 'not configured' }, { status: 503 })
  if (!isAuthorized(request.headers.get('authorization'), adminToken)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const requestedDays = Number(new URL(request.url).searchParams.get('days') ?? '30')
  const days = Number.isInteger(requestedDays) ? Math.min(90, Math.max(1, requestedDays)) : 30
  const summary = readTelemetrySummary(days)
  if (!summary) return Response.json({ error: 'storage not configured' }, { status: 503 })
  return Response.json(summary, { headers: { 'cache-control': 'no-store' } })
}

function isAuthorized(header: string | null, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice('Bearer '.length))
  const wanted = Buffer.from(expected)
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted)
}
