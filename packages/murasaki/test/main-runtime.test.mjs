import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MainRuntime } from '../dist/runtime/main-runtime.js'

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-main-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return new MainRuntime({
    appId: 'com.example.test',
    productName: 'Test',
    version: '1.2.3',
    projectRoot: root,
    resourcesPath: root,
    isPackaged: false,
    paths: {
      data: join(root, 'data'),
      cache: join(root, 'cache'),
      logs: join(root, 'logs'),
      temp: join(root, 'temp'),
    },
    ...overrides,
  })
}

test('runs main lifecycle in order and aborts background work before cleanup', async (t) => {
  const events = []
  const runtime = await fixture(t)
  const context = await runtime.start(async () => ({
    default: {
      ready(ctx) {
        events.push('ready')
        assert.equal(ctx.appId, 'com.example.test')
        assert.equal(ctx.signal.aborted, false)
      },
      beforeQuit(ctx) {
        events.push(`before:${ctx.reason}`)
        assert.equal(ctx.signal.aborted, false)
      },
      shutdown(ctx) {
        events.push(`shutdown:${ctx.reason}`)
        assert.equal(ctx.signal.aborted, true)
      },
    },
  }))

  assert.equal(context.version, '1.2.3')
  assert.equal(runtime.state, 'running')
  assert.deepEqual(await runtime.shutdown({ reason: 'app-quit' }), {
    cancelled: false,
    timedOut: false,
  })
  assert.equal(runtime.state, 'stopped')
  assert.deepEqual(events, ['ready', 'before:app-quit', 'shutdown:app-quit'])
})

test('allows beforeQuit to cancel and accepts a later forced shutdown', async (t) => {
  let attempts = 0
  const runtime = await fixture(t)
  await runtime.start(async () => ({
    default: {
      beforeQuit() {
        attempts++
        return false
      },
    },
  }))

  assert.deepEqual(await runtime.shutdown({ reason: 'window-close' }), {
    cancelled: true,
    timedOut: false,
  })
  assert.equal(runtime.state, 'running')
  assert.deepEqual(await runtime.shutdown({ reason: 'signal', force: true }), {
    cancelled: false,
    timedOut: false,
  })
  assert.equal(attempts, 1)
})

test('bounds graceful shutdown time', async (t) => {
  const runtime = await fixture(t, { shutdownTimeoutMs: 20 })
  await runtime.start(async () => ({
    default: { shutdown: () => new Promise(() => {}) },
  }))
  assert.deepEqual(await runtime.shutdown({ reason: 'signal' }), {
    cancelled: false,
    timedOut: true,
  })
  assert.equal(runtime.state, 'stopped')
})

test('rejects invalid main modules and exposes a failed state', async (t) => {
  const runtime = await fixture(t)
  await assert.rejects(runtime.start(async () => ({ default: null })), /default-export/)
  assert.equal(runtime.state, 'failed')
})

test('delivers second-launch arguments to the running main instance', async (t) => {
  const events = []
  const runtime = await fixture(t)
  await runtime.start(async () => ({
    default: {
      secondInstance(context, event) {
        events.push([context.appId, event])
      },
    },
  }))
  await runtime.secondInstance({ argv: ['murasaki://open/42'], cwd: '/tmp' })
  assert.deepEqual(events, [[
    'com.example.test',
    { argv: ['murasaki://open/42'], cwd: '/tmp' },
  ]])
})

test('delivers normalized open requests after ready', async (t) => {
  const events = []
  const runtime = await fixture(t)
  await runtime.start(async () => ({
    default: {
      ready() { events.push('ready') },
      openRequested(context, event) { events.push([context.appId, event]) },
    },
  }))
  const request = {
    activation: 'cold-start',
    transport: 'argv',
    targets: [{ kind: 'url', url: 'violet://open/42', scheme: 'violet' }],
    cwd: '/tmp',
  }
  await runtime.openRequested(request)
  assert.deepEqual(events, ['ready', ['com.example.test', request]])
})

test('serializes open requests in arrival order', async (t) => {
  const events = []
  let releaseFirst
  const firstCanFinish = new Promise((resolve) => { releaseFirst = resolve })
  const runtime = await fixture(t)
  await runtime.start(async () => ({
    default: {
      async openRequested(_context, event) {
        events.push(`start:${event.targets[0].path}`)
        if (event.targets[0].path === '/tmp/first.vnote') await firstCanFinish
        events.push(`end:${event.targets[0].path}`)
      },
    },
  }))

  const first = runtime.openRequested({
    activation: 'cold-start',
    transport: 'argv',
    targets: [{ kind: 'file', path: '/tmp/first.vnote' }],
  })
  const second = runtime.openRequested({
    activation: 'second-instance',
    transport: 'argv',
    targets: [{ kind: 'file', path: '/tmp/second.vnote' }],
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['start:/tmp/first.vnote'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, [
    'start:/tmp/first.vnote',
    'end:/tmp/first.vnote',
    'start:/tmp/second.vnote',
    'end:/tmp/second.vnote',
  ])
})

test('rejects an open request synchronously when the bounded queue is full', async (t) => {
  const runtime = await fixture(t)
  await runtime.start(async () => ({
    default: { openRequested: () => new Promise(() => {}) },
  }))
  const request = {
    activation: 'second-instance',
    transport: 'argv',
    targets: [{ kind: 'file', path: '/tmp/example.vnote' }],
  }
  for (let index = 0; index < 32; index++) runtime.openRequested(request)
  assert.throws(() => runtime.openRequested(request), /queue is full/)
})
