import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const SETTINGS_PATH = join(homedir(), '.murasaki', 'telemetry.json')
const DEFAULT_ENDPOINT = 'https://murasaki.ichi10.com/api/telemetry/v1/events'

export async function setTelemetryEnabled(enabled) {
  const current = await readSettings()
  const settings = {
    enabled,
    anonymousId: current?.anonymousId ?? randomUUID(),
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dirname(SETTINGS_PATH), { recursive: true, mode: 0o700 })
  await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  await chmod(SETTINGS_PATH, 0o600)
  return settings
}

export async function getTelemetryPreference() {
  const settings = await readSettings()
  return settings ? settings.enabled : null
}

export async function recordCreateCompleted(version) {
  if (telemetryBlockedByEnvironment()) return
  const settings = await readSettings()
  if (!settings?.enabled) return

  try {
    await fetch(process.env.MURASAKI_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: 1,
        event: 'create_completed',
        anonymousId: settings.anonymousId,
        version: version ?? 'unknown',
        platform: process.platform,
        arch: process.arch,
        occurredAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(1_000),
    })
  } catch {
    // Scaffolding must never fail because measurement is unavailable.
  }
}

function telemetryBlockedByEnvironment() {
  const disabled = process.env.MURASAKI_TELEMETRY_DISABLED?.toLowerCase()
  return (
    disabled === '1' ||
    disabled === 'true' ||
    process.env.DO_NOT_TRACK === '1' ||
    process.env.CI !== undefined
  )
}

async function readSettings() {
  try {
    const value = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'))
    if (
      typeof value.enabled !== 'boolean' ||
      typeof value.anonymousId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.anonymousId,
      )
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}
