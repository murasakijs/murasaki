import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface StoredTelemetryEvent {
  event: string
  anonymousHash: string
  version: string
  platform: string
  arch: string
  receivedAt: string
}

export interface TelemetrySummary {
  windowDays: number
  uniqueInstallations: number
  totals: Record<string, number>
  daily: Array<{
    date: string
    events: Record<string, number>
    dimensions: Record<string, number>
  }>
}

const globalStore = globalThis as typeof globalThis & {
  __murasakiTelemetryDatabase?: DatabaseSync
}

export function writeTelemetryAggregate(event: StoredTelemetryEvent): boolean {
  const database = telemetryDatabase()
  if (!database) return false

  const day = event.receivedAt.slice(0, 10)
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(`
        INSERT INTO daily_events (day, event, count) VALUES (?, ?, 1)
        ON CONFLICT (day, event) DO UPDATE SET count = count + 1
      `)
      .run(day, event.event)
    database
      .prepare('INSERT OR IGNORE INTO daily_users (day, anonymous_hash) VALUES (?, ?)')
      .run(day, event.anonymousHash)
    database
      .prepare(`
        INSERT INTO daily_dimensions (day, event, version, platform, arch, count)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT (day, event, version, platform, arch) DO UPDATE SET count = count + 1
      `)
      .run(day, event.event, event.version, event.platform, event.arch)
    database.prepare('DELETE FROM daily_events WHERE day < ?').run(cutoff)
    database.prepare('DELETE FROM daily_users WHERE day < ?').run(cutoff)
    database.prepare('DELETE FROM daily_dimensions WHERE day < ?').run(cutoff)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return true
}

export function readTelemetrySummary(days: number): TelemetrySummary | null {
  const database = telemetryDatabase()
  if (!database) return null

  const dates = recentUtcDates(days)
  const start = dates[0]
  const daily = new Map<string, TelemetrySummary['daily'][number]>(
    dates.map((date) => [date, { date, events: {}, dimensions: {} }]),
  )
  const totals: Record<string, number> = {}

  const eventRows = database
    .prepare('SELECT day, event, count FROM daily_events WHERE day >= ? ORDER BY day, event')
    .all(start) as Array<{ day: string; event: string; count: number }>
  for (const row of eventRows) {
    const entry = daily.get(row.day)
    if (!entry) continue
    entry.events[row.event] = row.count
    totals[row.event] = (totals[row.event] ?? 0) + row.count
  }

  const dimensionRows = database
    .prepare(`
      SELECT day, event, version, platform, arch, count
      FROM daily_dimensions
      WHERE day >= ?
      ORDER BY day, event, version, platform, arch
    `)
    .all(start) as Array<{
      day: string
      event: string
      version: string
      platform: string
      arch: string
      count: number
    }>
  for (const row of dimensionRows) {
    const entry = daily.get(row.day)
    if (!entry) continue
    entry.dimensions[`${row.event}:${row.version}:${row.platform}:${row.arch}`] = row.count
  }

  const uniqueRow = database
    .prepare('SELECT COUNT(DISTINCT anonymous_hash) AS count FROM daily_users WHERE day >= ?')
    .get(start) as { count: number }

  return {
    windowDays: days,
    uniqueInstallations: Number(uniqueRow.count),
    totals,
    daily: [...daily.values()],
  }
}

function telemetryDatabase(): DatabaseSync | null {
  if (globalStore.__murasakiTelemetryDatabase) return globalStore.__murasakiTelemetryDatabase
  const path = process.env.MURASAKI_TELEMETRY_DB_PATH
  if (!path) return null
  if (!isAbsolute(path)) throw new Error('MURASAKI_TELEMETRY_DB_PATH must be an absolute path')

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(path)
  chmodSync(path, 0o600)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS daily_events (
      day TEXT NOT NULL,
      event TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (day, event)
    );
    CREATE TABLE IF NOT EXISTS daily_users (
      day TEXT NOT NULL,
      anonymous_hash TEXT NOT NULL,
      PRIMARY KEY (day, anonymous_hash)
    );
    CREATE TABLE IF NOT EXISTS daily_dimensions (
      day TEXT NOT NULL,
      event TEXT NOT NULL,
      version TEXT NOT NULL,
      platform TEXT NOT NULL,
      arch TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (day, event, version, platform, arch)
    );
  `)
  globalStore.__murasakiTelemetryDatabase = database
  return database
}

function recentUtcDates(days: number): string[] {
  const dates: string[] = []
  const today = new Date()
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset))
    dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}
