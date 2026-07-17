import assert from 'node:assert/strict'
import { basename, dirname, join } from 'node:path'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { createSidecarSupervisor } from '../dist/main/index.js'

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-sidecar-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const controller = new AbortController()
  const supervisor = await createSidecarSupervisor({
    resourcesPath: dirname(process.execPath),
    paths: { data: root, cache: root, temp: root },
    signal: controller.signal,
    ...overrides,
  })
  return { root, controller, supervisor }
}

function waitForEvent(handle, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stop()
      reject(new Error('timed out waiting for sidecar event'))
    }, timeoutMs)
    const stop = handle.onEvent((event) => {
      if (!predicate(event)) return
      clearTimeout(timeout)
      stop()
      resolve(event)
    })
  })
}

test('runs a contained executable without a shell and stops it cleanly', async (t) => {
  const { supervisor } = await fixture(t)
  const handle = await supervisor.spawn({
    name: 'node-probe',
    resource: basename(process.execPath),
    args: ['-e', "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"],
    cwd: 'temp',
    env: { MURASAKI_SIDECAR_PROBE: '1' },
  })

  assert.ok(handle.pid)
  const output = await waitForEvent(handle, (event) => event.type === 'stdout')
  assert.match(output.data, /ready/)
  assert.deepEqual(supervisor.list().map((entry) => entry.name), ['node-probe'])
  await handle.stop()
  const finished = await handle.finished
  assert.equal(finished.signal === 'SIGTERM' || finished.code === 0, true)
  assert.deepEqual(supervisor.list(), [])
})

test('rejects traversal, symlink escapes, unsafe names, and unbounded input', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-sidecar-root-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await symlink(process.execPath, join(root, 'escaped-node'))
  const controller = new AbortController()
  const supervisor = await createSidecarSupervisor({
    resourcesPath: root,
    paths: { data: root, cache: root, temp: root },
    signal: controller.signal,
  })

  await assert.rejects(
    supervisor.spawn({ name: 'escape', resource: 'escaped-node' }),
    /below resourcesPath/,
  )
  await assert.rejects(
    supervisor.spawn({ name: '../bad', resource: 'missing' }),
    /safe characters/,
  )
  await assert.rejects(
    supervisor.spawn({ name: 'large', resource: 'missing', args: ['x'.repeat(9_000)] }),
    /no larger than/,
  )
})

test('an abort stops every live sidecar and rejects later starts', async (t) => {
  const { controller, supervisor } = await fixture(t)
  const handle = await supervisor.spawn({
    name: 'abort-probe',
    resource: basename(process.execPath),
    args: ['-e', 'setInterval(() => {}, 1000)'],
  })
  controller.abort('shutdown')
  await handle.finished
  assert.deepEqual(supervisor.list(), [])
  await assert.rejects(
    supervisor.spawn({ name: 'late', resource: basename(process.execPath) }),
    /stopping/,
  )
})
