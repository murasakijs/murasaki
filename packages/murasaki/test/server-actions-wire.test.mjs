import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import test from 'node:test'

import { stringifyWire, parseWire, WIRE_CONTENT_TYPE } from '../dist/runtime/wire.js'
import { serverActionsPlugin } from '../dist/vite-plugin/server-actions.js'

const packageDir = resolve(import.meta.dirname, '..')

function richArgument() {
  const value = {
    date: new Date('2026-07-16T07:01:00.000Z'),
    count: 9007199254740993n,
    bytes: new Uint8Array([9, 8, 7]),
    map: new Map([['missing', undefined]]),
    form: new FormData(),
  }
  value.self = value
  value.form.append('title', 'Murasaki')
  value.form.append('asset', new Blob(['asset'], { type: 'text/plain' }), 'asset.txt')
  return value
}

function assertRichResult(result) {
  assert.equal(result.self, result)
  assert.equal(result.date.toISOString(), '2026-07-16T07:01:00.000Z')
  assert.equal(result.count, 9007199254740993n)
  assert.deepEqual([...result.bytes], [9, 8, 7])
  assert.equal(result.map.has('missing'), true)
  assert.equal(result.map.get('missing'), undefined)
  assert.equal(result.form.get('title'), 'Murasaki')
  assert.equal(result.form.get('asset').name, 'asset.txt')
}

test('server action client transform uses the shared versioned wire codec', async () => {
  const plugin = serverActionsPlugin({ srcDir: '/project/src' })
  const transformed = await plugin.transform.call(
    {},
    `'use server'\nexport async function save(value) { return value }`,
    '/project/src/actions.ts',
    { ssr: false },
  )
  assert.match(transformed.code, /virtual:murasaki\/wire/)
  assert.match(transformed.code, /await __murasakiStringifyWire\(\{ args \}\)/)
  assert.match(transformed.code, /__murasakiParseWire\(await res\.text\(\)\)/)
  assert.doesNotMatch(transformed.code, /JSON\.stringify|res\.json\(/)
})

test('development action middleware round-trips rich values and structured errors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-dev-actions-'))
  const srcDir = join(root, 'src')
  const actionPath = join(srcDir, 'actions.ts')
  await mkdir(srcDir)
  await writeFile(actionPath, `'use server'\nexport async function echo(value) { return value }\n`)
  await writeFile(join(root, 'private.ts'), `export function readSecret() { return 'secret' }\n`)
  t.after(() => rm(root, { recursive: true, force: true }))

  let middleware
  let loadCalls = 0
  const plugin = serverActionsPlugin({ srcDir })
  plugin.configResolved({ root })
  plugin.configureServer({
    middlewares: { use(handler) { middleware = handler } },
    async ssrLoadModule(id) {
      loadCalls++
      assert.equal(id, actionPath)
      return {
        async echo(value) { return value },
        async fail() {
          const error = new Error('action exploded', { cause: new TypeError('root cause') })
          error.code = 'E_ACTION'
          throw error
        },
      }
    },
  })

  const server = http.createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404
      res.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/__murasaki/action/${encodeURIComponent('src/actions.ts')}`

  const response = await fetch(`${base}/echo`, {
    method: 'POST',
    headers: { 'content-type': WIRE_CONTENT_TYPE },
    body: await stringifyWire({ args: [richArgument()] }),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /application\/vnd\.murasaki\.wire\+json/)
  const payload = parseWire(await response.text())
  assert.equal(payload.ok, true)
  assertRichResult(payload.value)

  const failed = await fetch(`${base}/fail`, {
    method: 'POST',
    headers: { 'content-type': WIRE_CONTENT_TYPE },
    body: await stringifyWire({ args: [] }),
  })
  assert.equal(failed.status, 500)
  const failedPayload = parseWire(await failed.text())
  assert.equal(failedPayload.ok, false)
  assert.equal(failedPayload.error instanceof Error, true)
  assert.equal(failedPayload.error.message, 'action exploded')
  assert.equal(failedPayload.error.code, 'E_ACTION')
  assert.equal(failedPayload.error.cause.name, 'TypeError')
  assert.equal(failedPayload.error.cause.message, 'root cause')

  const malformed = await fetch(`${base}/echo`, { method: 'POST', body: '{"args":[]}' })
  assert.equal(malformed.status, 400)
  const malformedPayload = parseWire(await malformed.text())
  assert.equal(malformedPayload.ok, false)
  assert.equal(malformedPayload.error instanceof Error, true)

  const escaped = await fetch(
    `http://127.0.0.1:${port}/__murasaki/action/${encodeURIComponent('private.ts')}/readSecret`,
    {
      method: 'POST',
      headers: { 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [] }),
    },
  )
  assert.equal(escaped.status, 404)
  assert.equal(loadCalls, 2)
})

test('production action server uses the same codec contract as development', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-actions-wire-'))
  const clientDir = join(root, 'client')
  const serverDir = join(root, 'server')
  await mkdir(clientDir)
  await mkdir(serverDir)
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>test</title>')
  await writeFile(
    join(serverDir, 'actions.mjs'),
    `
export const registry = {
  'src/actions.ts': {
    async echo(value) { return value },
    async fail() {
      const error = new Error('prod exploded', { cause: new TypeError('prod cause') })
      error.code = 'E_PROD_ACTION'
      throw error
    },
  },
}
`,
  )
  await writeFile(join(serverDir, 'routes.mjs'), 'export const routes = []\n')
  await writeFile(join(serverDir, 'main.mjs'), 'export default {}\n')
  await copyFile(join(packageDir, 'assets/prod-server.mjs'), join(root, 'prod-server.mjs'))
  await copyFile(join(packageDir, 'dist/runtime/updater.js'), join(root, 'updater-engine.mjs'))
  await copyFile(join(packageDir, 'dist/runtime/wire.js'), join(root, 'wire.mjs'))
  await copyFile(join(packageDir, 'dist/runtime/main-runtime.js'), join(root, 'main-runtime.mjs'))

  const child = spawn(
    process.execPath,
    [
      join(root, 'prod-server.mjs'),
      '--client', clientDir,
      '--registry', join(serverDir, 'actions.mjs'),
      '--routes', join(serverDir, 'routes.mjs'),
      '--main', join(serverDir, 'main.mjs'),
      '--port', '0',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: root } },
  )
  t.after(async () => {
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), new Promise((resolveOk) => setTimeout(resolveOk, 1000))])
    await rm(root, { recursive: true, force: true })
  })

  const lines = createInterface({ input: child.stdout })
  const port = await new Promise((resolveOk, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not report a port')), 5000)
    lines.on('line', (line) => {
      const match = /^MURASAKI_PORT=(\d+)$/.exec(line)
      if (!match) return
      clearTimeout(timeout)
      resolveOk(Number(match[1]))
    })
    child.once('exit', (code) => reject(new Error(`server exited early (${code})`)))
  })
  const origin = `http://127.0.0.1:${port}`
  const bootstrap = await fetch(`${origin}/`)
  const runtimeCookie = (bootstrap.headers.getSetCookie?.()[0] ?? bootstrap.headers.get('set-cookie')).split(';', 1)[0]
  const base = `${origin}/__murasaki/action/${encodeURIComponent('src/actions.ts')}`
  const headers = { cookie: runtimeCookie, 'content-type': WIRE_CONTENT_TYPE }

  const response = await fetch(`${base}/echo`, {
    method: 'POST',
    headers,
    body: await stringifyWire({ args: [richArgument()] }),
  })
  assert.equal(response.status, 200)
  const payload = parseWire(await response.text())
  assert.equal(payload.ok, true)
  assertRichResult(payload.value)

  const failed = await fetch(`${base}/fail`, {
    method: 'POST', headers, body: await stringifyWire({ args: [] }),
  })
  assert.equal(failed.status, 500)
  const failedPayload = parseWire(await failed.text())
  assert.equal(failedPayload.ok, false)
  assert.equal(failedPayload.error.message, 'prod exploded')
  assert.equal(failedPayload.error.code, 'E_PROD_ACTION')
  assert.equal(failedPayload.error.cause.message, 'prod cause')

  const inherited = await fetch(
    `${origin}/__murasaki/action/${encodeURIComponent('constructor')}/assign`,
    {
      method: 'POST',
      headers,
      body: await stringifyWire({ args: [] }),
    },
  )
  assert.equal(inherited.status, 404)
})
