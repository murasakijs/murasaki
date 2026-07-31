import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { murasakiVersion } from './brand.js'

export type TelemetryEvent = 'create_completed' | 'dev_started' | 'bundle_completed'

interface TelemetrySettings {
  enabled: boolean
  anonymousId: string
  updatedAt: string
}

const SETTINGS_PATH = join(homedir(), '.murasaki', 'telemetry.json')
const DEFAULT_ENDPOINT = 'https://murasaki.ichi10.com/api/telemetry/v1/events'

/**
 * Anonymous CLI measurement is opt-in. This module never inspects the project,
 * command arguments, paths, account details, source code, or environment
 * values other than the documented privacy controls below.
 */
export async function recordTelemetry(event: TelemetryEvent): Promise<void> {
  if (telemetryBlockedByEnvironment()) return
  const settings = await readSettings()
  if (!settings?.enabled) return

  const endpoint = process.env.MURASAKI_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: 1,
        event,
        anonymousId: settings.anonymousId,
        version: murasakiVersion(),
        platform: process.platform,
        arch: process.arch,
        occurredAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(1_000),
    })
  } catch {
    // Measurement must never affect a development or packaging command.
  }
}

export async function telemetryStatus(): Promise<'enabled' | 'disabled'> {
  const settings = await readSettings()
  return settings?.enabled ? 'enabled' : 'disabled'
}

export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  const current = await readSettings()
  await writeSettings({
    enabled,
    anonymousId: current?.anonymousId ?? randomUUID(),
    updatedAt: new Date().toISOString(),
  })
}

export default async function telemetry(argv: string[]): Promise<void> {
  const action = argv[0] ?? 'status'
  if (action === 'enable') {
    await setTelemetryEnabled(true)
    process.stdout.write(
      '\n  Anonymous CLI usage measurement enabled. No project names, paths, code, or account data are sent.\n' +
        "  Run 'murasaki telemetry disable' at any time.\n\n",
    )
    return
  }
  if (action === 'disable') {
    await setTelemetryEnabled(false)
    process.stdout.write('\n  Anonymous CLI usage measurement disabled.\n\n')
    return
  }
  if (action === 'status') {
    const status = await telemetryStatus()
    process.stdout.write(`\n  Anonymous CLI usage measurement: ${status}\n\n`)
    return
  }
  throw new Error("usage: murasaki telemetry <enable|disable|status>")
}

function telemetryBlockedByEnvironment(): boolean {
  const disabled = process.env.MURASAKI_TELEMETRY_DISABLED?.toLowerCase()
  return (
    disabled === '1' ||
    disabled === 'true' ||
    process.env.DO_NOT_TRACK === '1' ||
    process.env.CI !== undefined
  )
}

async function readSettings(): Promise<TelemetrySettings | null> {
  try {
    const value = JSON.parse(await readFile(SETTINGS_PATH, 'utf8')) as Partial<TelemetrySettings>
    if (
      typeof value.enabled !== 'boolean' ||
      typeof value.anonymousId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.anonymousId,
      )
    ) {
      return null
    }
    return {
      enabled: value.enabled,
      anonymousId: value.anonymousId,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    }
  } catch {
    return null
  }
}

async function writeSettings(settings: TelemetrySettings): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true, mode: 0o700 })
  await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  await chmod(SETTINGS_PATH, 0o600)
}
