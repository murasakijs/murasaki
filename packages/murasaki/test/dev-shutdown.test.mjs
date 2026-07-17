import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { mainProcessPlugin } from '../dist/vite-plugin/main-process.js'
import { runtimeToken } from '../dist/vite-plugin/runtime-security.js'

test('dev native shutdown is authenticated, cancellable, and retryable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-dev-shutdown-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/main.ts'), 'export default {}')
  t.after(() => rm(root, { recursive: true, force: true }))

  let attempts = 0
  let cleanupCalls = 0
  let middleware
  const plugin = mainProcessPlugin({
    config: {
      appId: 'dev.test.shutdown',
      productName: 'Shutdown Test',
      main: { shutdownTimeoutMs: 100 },
      diagnostics: { crashReports: false },
    },
  })
  const afterConfigure = plugin.configureServer({
    config: { root },
    middlewares: { use(handler) { middleware = handler } },
    watcher: { on() {} },
    httpServer: { once() {} },
    moduleGraph: { getModuleById() { return undefined }, invalidateModule() {} },
    logger: { error() {} },
    async ssrLoadModule() {
      return {
        default: {
          beforeQuit() {
            attempts++
            if (attempts === 1) return false
          },
          shutdown() { cleanupCalls++ },
        },
      }
    },
  })
  await afterConfigure()

  const server = http.createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404
    res.end()
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const token = runtimeToken()
  const url = `http://127.0.0.1:${server.address().port}/__murasaki/main/shutdown`
  const shutdown = (force) => fetch(url, {
    method: 'POST',
    headers: {
      cookie: `murasaki_runtime=${token}`,
      'content-type': 'application/json',
      'x-murasaki-native-token': token,
    },
    body: JSON.stringify(force === undefined
      ? { reason: 'window-close' }
      : { reason: 'window-close', force }),
  })

  const cancelled = await shutdown()
  assert.equal(cancelled.status, 200)
  assert.deepEqual(await cancelled.json(), { cancelled: true, timedOut: false })
  assert.equal(cleanupCalls, 0)

  const completed = await shutdown(false)
  assert.equal(completed.status, 200)
  assert.deepEqual(await completed.json(), { cancelled: false, timedOut: false })
  assert.equal(attempts, 2)
  assert.equal(cleanupCalls, 1)

  const forbidden = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'app-quit', force: false }),
  })
  assert.equal(forbidden.status, 403)
})

test('native shutdown freezes an in-flight HMR transition instead of starting another runtime', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-dev-hmr-shutdown-'))
  const entry = join(root, 'src/main.ts')
  await mkdir(join(root, 'src'))
  await writeFile(entry, 'export default {}')
  t.after(() => rm(root, { recursive: true, force: true }))

  let middleware
  let changed
  let loadCalls = 0
  const plugin = mainProcessPlugin({
    config: {
      appId: 'dev.test.hmr-shutdown',
      productName: 'HMR Shutdown Test',
      main: { shutdownTimeoutMs: 30 },
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
      loadCalls++
      return { default: { shutdown: () => new Promise(() => {}) } }
    },
  })
  await afterConfigure()
  assert.equal(loadCalls, 1)

  changed(entry)
  await new Promise((resolve) => setImmediate(resolve))

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
        cookie: `murasaki_runtime=${token}`,
        'content-type': 'application/json',
        'x-murasaki-native-token': token,
      },
      body: JSON.stringify({ reason: 'app-quit', force: true }),
    },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { cancelled: false, timedOut: true })

  // The shutdown request marks the server as closing before the old runtime
  // settles, so the queued HMR continuation must not load a replacement.
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(loadCalls, 1)
})

test('a cancelled native shutdown resumes main-module HMR', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-dev-cancelled-shutdown-'))
  const entry = join(root, 'src/main.ts')
  await mkdir(join(root, 'src'))
  await writeFile(entry, 'export default {}')
  t.after(() => rm(root, { recursive: true, force: true }))

  let middleware
  let changed
  let loadCalls = 0
  const plugin = mainProcessPlugin({
    config: {
      appId: 'dev.test.cancelled-shutdown',
      productName: 'Cancelled Shutdown Test',
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
      loadCalls++
      return { default: { beforeQuit: () => false } }
    },
  })
  await afterConfigure()

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
        cookie: `murasaki_runtime=${token}`,
        'content-type': 'application/json',
        'x-murasaki-native-token': token,
      },
      body: JSON.stringify({ reason: 'window-close' }),
    },
  )
  assert.deepEqual(await response.json(), { cancelled: true, timedOut: false })

  changed(entry)
  for (let attempt = 0; attempt < 20 && loadCalls < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(loadCalls, 2)
})

test('a rejected beforeQuit also resumes main-module HMR', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-dev-rejected-shutdown-'))
  const entry = join(root, 'src/main.ts')
  await mkdir(join(root, 'src'))
  await writeFile(entry, 'export default {}')
  t.after(() => rm(root, { recursive: true, force: true }))

  let middleware
  let changed
  let loadCalls = 0
  const plugin = mainProcessPlugin({
    config: {
      appId: 'dev.test.rejected-shutdown',
      productName: 'Rejected Shutdown Test',
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
      loadCalls++
      return { default: { beforeQuit: () => { throw new Error('dev quit veto failed') } } }
    },
  })
  await afterConfigure()

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
        cookie: `murasaki_runtime=${token}`,
        'content-type': 'application/json',
        'x-murasaki-native-token': token,
      },
      body: JSON.stringify({ reason: 'window-close' }),
    },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { cancelled: true, timedOut: false })

  changed(entry)
  for (let attempt = 0; attempt < 20 && loadCalls < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(loadCalls, 2)
})
