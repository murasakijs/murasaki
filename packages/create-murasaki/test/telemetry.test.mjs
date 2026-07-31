import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('create completion is sent only after an explicit opt-in', async () => {
  process.env.HOME = await mkdtemp(join(tmpdir(), 'create-murasaki-telemetry-'))
  delete process.env.CI
  delete process.env.DO_NOT_TRACK

  const bodies = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(null, { status: 204 })
  }

  try {
    const telemetry = await import('../telemetry.mjs')
    assert.equal(await telemetry.getTelemetryPreference(), null)
    await telemetry.recordCreateCompleted('1.2.3')
    assert.equal(bodies.length, 0)

    await telemetry.setTelemetryEnabled(true)
    await telemetry.recordCreateCompleted('1.2.3')
    assert.equal(bodies.length, 1)
    assert.deepEqual(
      Object.keys(bodies[0]).sort(),
      ['anonymousId', 'arch', 'event', 'occurredAt', 'platform', 'schema', 'version'].sort(),
    )
    assert.equal(bodies[0].event, 'create_completed')
  } finally {
    globalThis.fetch = originalFetch
  }
})
