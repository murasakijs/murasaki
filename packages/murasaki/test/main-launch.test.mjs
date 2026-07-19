import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { MainRuntime } from '../dist/runtime/main-runtime.js'

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-main-launch-'))
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
    diagnostics: { crashReports: false },
    ...overrides,
  })
}

test('exposes launcher-supplied argv + cwd on MainContext.launch and to ready()', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-main-launch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let readyLaunch
  const runtime = await fixture(t, {
    projectRoot: root,
    resourcesPath: root,
    launch: { argv: ['--no-sample-data', 'x'], cwd: '/some/dir' },
  })
  const context = await runtime.start(async () => ({
    default: {
      ready(ctx) {
        readyLaunch = ctx.launch
      },
    },
  }))

  assert.deepEqual(context.launch.argv, ['--no-sample-data', 'x'])
  assert.equal(context.launch.cwd, '/some/dir')
  assert.deepEqual(readyLaunch, context.launch)

  await runtime.shutdown({ reason: 'app-quit' })
})

test('defaults to empty argv and the resolved project root when launch is omitted', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-main-launch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runtime = await fixture(t, { projectRoot: root, resourcesPath: root })
  const context = await runtime.start(async () => ({ default: {} }))

  assert.deepEqual(context.launch.argv, [])
  assert.equal(context.launch.cwd, resolve(root))

  await runtime.shutdown({ reason: 'app-quit' })
})

test('bounds launch argv: caps entry count, drops non-strings and oversized args', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-main-launch-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const many = Array.from({ length: 200 }, (_, i) => `--flag${i}`)
  const runtimeCapped = await fixture(t, {
    projectRoot: root,
    resourcesPath: root,
    launch: { argv: many, cwd: root },
  })
  const cappedContext = await runtimeCapped.start(async () => ({ default: {} }))
  assert.equal(cappedContext.launch.argv.length, 64)
  assert.deepEqual(cappedContext.launch.argv, many.slice(0, 64))
  await runtimeCapped.shutdown({ reason: 'app-quit' })

  const runtimeMixed = await fixture(t, {
    projectRoot: root,
    resourcesPath: root,
    launch: { argv: ['keep', 42, 'x'.repeat(8193), 'also-keep'], cwd: root },
  })
  const mixedContext = await runtimeMixed.start(async () => ({ default: {} }))
  assert.deepEqual(mixedContext.launch.argv, ['keep', 'also-keep'])
  await runtimeMixed.shutdown({ reason: 'app-quit' })
})
