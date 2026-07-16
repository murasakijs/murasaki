import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { mainModulesPlugin } from '../dist/vite-plugin/main-modules.js'
import { parseWire, stringifyWire, WIRE_CONTENT_TYPE } from '../dist/runtime/wire.js'

test('use main preserves normal imports while generating wire RPC stubs', () => {
  const plugin = mainModulesPlugin({ srcDir: '/project/src' })
  const transformed = plugin.transform.call(
    {},
    `'use main'\nexport async function query(value) { return value }`,
    '/project/src/services/database.ts',
    { ssr: false },
  )
  assert.match(transformed.code, /__murasaki\/main\/call/)
  assert.match(transformed.code, /virtual:murasaki\/wire/)
  assert.match(transformed.code, /export async function query/)
  assert.doesNotMatch(transformed.code, /JSON\.stringify|res\.json/)

  assert.equal(plugin.transform.call(
    {},
    `'use main'\nexport async function query() {}`,
    '/project/src/services/database.ts',
    { ssr: true },
  ), null)
})

test('development main module calls execute in the Node server module graph', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-dev-main-modules-'))
  const srcDir = join(root, 'src')
  const modulePath = join(srcDir, 'services/database.ts')
  await mkdir(join(srcDir, 'services'), { recursive: true })
  await writeFile(modulePath, `'use main'\nexport async function query(value) { return value }\n`)
  await writeFile(join(root, 'private.ts'), `export function readSecret() { return 'secret' }\n`)
  t.after(() => rm(root, { recursive: true, force: true }))

  let middleware
  let loadCalls = 0
  const plugin = mainModulesPlugin({ srcDir })
  plugin.configResolved({ root })
  plugin.configureServer({
    middlewares: { use(handler) { middleware = handler } },
    async ssrLoadModule(id) {
      loadCalls++
      assert.equal(id, modulePath)
      return {
        async query(input) {
          return { ...input, node: process.version, value: input.value + 1n }
        },
      }
    },
  })

  const server = http.createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404
    res.end()
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const id = encodeURIComponent('src/services/database.ts')
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/__murasaki/main/call/${id}/query`,
    {
      method: 'POST',
      headers: { 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [{ value: 41n, at: new Date('2026-07-16') }] }),
    },
  )
  assert.equal(response.status, 200)
  const payload = parseWire(await response.text())
  assert.equal(payload.ok, true)
  assert.equal(payload.value.value, 42n)
  assert.equal(payload.value.at.toISOString(), '2026-07-16T00:00:00.000Z')
  assert.match(payload.value.node, /^v/)

  const escaped = await fetch(
    `http://127.0.0.1:${server.address().port}/__murasaki/main/call/${encodeURIComponent('private.ts')}/readSecret`,
    {
      method: 'POST',
      headers: { 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [] }),
    },
  )
  assert.equal(escaped.status, 404)
  assert.equal(loadCalls, 1)
})
