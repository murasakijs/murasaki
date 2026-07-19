import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEV_LAUNCH_ENV,
  MAX_LAUNCH_TOTAL_BYTES,
  consumeDevLaunchArgv,
  encodeDevLaunchArgv,
  parseDevAppArgv,
  sanitizeLaunchArgv,
} from '../dist/runtime/launch.js'
import { mainProcessPlugin } from '../dist/vite-plugin/main-process.js'

test('parseDevAppArgv: forwards only what follows the first standalone `--`', () => {
  assert.deepEqual(parseDevAppArgv(['--', '--no-sample-data']), ['--no-sample-data'])

  assert.deepEqual(
    parseDevAppArgv(['--some-dev-flag', 'x', '--', '--no-sample-data', '--port', '9999']),
    ['--no-sample-data', '--port', '9999'],
  )

  assert.deepEqual(parseDevAppArgv(['--no-sample-data']), [])

  assert.deepEqual(parseDevAppArgv(['--', 'a', '--', 'b']), ['a', '--', 'b'])
})

test('sanitizeLaunchArgv: caps count and drops non-strings/oversized entries', () => {
  const many = Array.from({ length: 200 }, (_, i) => `--flag${i}`)
  const capped = sanitizeLaunchArgv(many)
  assert.equal(capped.length, 64)
  assert.deepEqual(capped, many.slice(0, 64))

  assert.deepEqual(
    sanitizeLaunchArgv(['keep', 42, 'x'.repeat(8193), 'also-keep']),
    ['keep', 'also-keep'],
  )

  const escaped = sanitizeLaunchArgv(['\\"'.repeat(4_000), 'x'.repeat(5_000)])
  assert.equal(escaped.length, 1)
  assert.ok(Buffer.byteLength(JSON.stringify(escaped), 'utf8') <= MAX_LAUNCH_TOTAL_BYTES)
})

test('dev launch env transport: round-trips and deletes on read', () => {
  assert.equal(encodeDevLaunchArgv([]), '')

  const env = {}
  env[DEV_LAUNCH_ENV] = encodeDevLaunchArgv(['--no-sample-data'])
  assert.deepEqual(consumeDevLaunchArgv(env), ['--no-sample-data'])
  assert.equal(env[DEV_LAUNCH_ENV], undefined)

  assert.deepEqual(consumeDevLaunchArgv({ [DEV_LAUNCH_ENV]: 'not json' }), [])

  assert.deepEqual(consumeDevLaunchArgv({}), [])
})

test('mainProcessPlugin: forwards the dev launch transport once, deletes it, and HMR shares the same frozen snapshot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-dev-launch-argv-'))
  const entry = join(root, 'src/main.ts')
  await mkdir(join(root, 'src'))
  await writeFile(entry, 'export default {}')
  t.after(() => rm(root, { recursive: true, force: true }))

  process.env[DEV_LAUNCH_ENV] = encodeDevLaunchArgv(['--no-sample-data', '--port', '9999'])
  t.after(() => { delete process.env[DEV_LAUNCH_ENV] })

  let middleware
  let changed
  const readyLaunches = []
  const plugin = mainProcessPlugin({
    config: {
      appId: 'dev.test.launch-argv',
      productName: 'Launch Argv Test',
      main: { shutdownTimeoutMs: 100 },
      diagnostics: { crashReports: false },
    },
  })
  const afterConfigure = plugin.configureServer({
    config: { root },
    middlewares: { use(handler) { middleware = handler } },
    watcher: { on(event, handler) { if (event === 'change') changed = handler } },
    httpServer: { once() {} },
    moduleGraph: { getModuleById() { return undefined }, invalidateModule() {} },
    logger: { error() {} },
    async ssrLoadModule() {
      return {
        default: {
          ready(ctx) {
            readyLaunches.push(ctx.launch)
          },
        },
      }
    },
  })

  await afterConfigure()

  assert.equal(readyLaunches.length, 1)
  assert.deepEqual(readyLaunches[0].argv, ['--no-sample-data', '--port', '9999'])
  assert.equal(readyLaunches[0].cwd, root)
  assert.equal(process.env[DEV_LAUNCH_ENV], undefined)

  changed(entry)
  for (let attempt = 0; attempt < 20 && readyLaunches.length < 2; attempt++) {
    await new Promise((resolveOk) => setTimeout(resolveOk, 5))
  }
  assert.equal(readyLaunches.length, 2)
  assert.deepEqual(readyLaunches[1], readyLaunches[0])

  // Clean shutdown through the same middleware path as dev-shutdown.test.mjs,
  // to avoid leaking timers.
  const http = await import('node:http')
  const { once } = await import('node:events')
  const { runtimeToken } = await import('../dist/vite-plugin/runtime-security.js')

  const server = http.createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404
    res.end()
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const token = runtimeToken()
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/__murasaki/main/shutdown`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-murasaki-native-token': token,
      },
      body: JSON.stringify({ reason: 'app-quit', force: true }),
    },
  )
  assert.equal(response.status, 200)
})
