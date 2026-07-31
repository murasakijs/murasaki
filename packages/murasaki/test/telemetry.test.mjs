import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('telemetry is disabled until the user explicitly enables it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'murasaki-telemetry-'))
  process.env.HOME = home
  delete process.env.CI
  delete process.env.DO_NOT_TRACK

  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    return new Response(null, { status: 204 })
  }

  try {
    const telemetry = await import('../dist/cli/telemetry.js')
    await telemetry.recordTelemetry('dev_started')
    assert.equal(requests.length, 0)

    await telemetry.setTelemetryEnabled(true)
    await telemetry.recordTelemetry('bundle_completed')
    assert.equal(requests.length, 1)

    const settingsPath = join(home, '.murasaki', 'telemetry.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    assert.equal(settings.enabled, true)
    assert.match(settings.anonymousId, /^[0-9a-f-]{36}$/i)
    assert.equal((await stat(settingsPath)).mode & 0o777, 0o600)

    process.env.DO_NOT_TRACK = '1'
    await telemetry.recordTelemetry('dev_started')
    assert.equal(requests.length, 1)

    await telemetry.setTelemetryEnabled(false)
    delete process.env.DO_NOT_TRACK
    await telemetry.recordTelemetry('dev_started')
    assert.equal(requests.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.DO_NOT_TRACK
  }
})
