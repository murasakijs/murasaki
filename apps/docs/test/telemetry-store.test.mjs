import assert from 'node:assert/strict'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('self-hosted telemetry store aggregates counts and unique installations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'murasaki-docs-telemetry-'))
  const databasePath = join(directory, 'telemetry.sqlite')
  process.env.MURASAKI_TELEMETRY_DB_PATH = databasePath
  const store = await import('../lib/telemetry-store.ts')
  const receivedAt = new Date().toISOString()

  store.writeTelemetryAggregate({
    event: 'dev_started',
    anonymousHash: 'a'.repeat(64),
    version: '1.0.0',
    platform: 'darwin',
    arch: 'arm64',
    receivedAt,
  })
  store.writeTelemetryAggregate({
    event: 'dev_started',
    anonymousHash: 'a'.repeat(64),
    version: '1.0.0',
    platform: 'darwin',
    arch: 'arm64',
    receivedAt,
  })
  store.writeTelemetryAggregate({
    event: 'bundle_completed',
    anonymousHash: 'b'.repeat(64),
    version: '1.0.0',
    platform: 'win32',
    arch: 'x64',
    receivedAt,
  })

  const summary = store.readTelemetrySummary(30)
  assert(summary)
  assert.equal(summary.uniqueInstallations, 2)
  assert.deepEqual(summary.totals, { bundle_completed: 1, dev_started: 2 })
  assert.equal(summary.daily.at(-1).events.dev_started, 2)
  assert.equal(summary.daily.at(-1).dimensions['dev_started:1.0.0:darwin:arm64'], 2)
  assert.equal((await stat(databasePath)).mode & 0o777, 0o600)
})
