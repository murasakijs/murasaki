import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { parseWire, stringifyWire, WIRE_CONTENT_TYPE } from '../dist/runtime/wire.js'

const packageDir = resolve(import.meta.dirname, '..')

test('production API server streams requests/responses and preserves HTTP semantics', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-prod-http-'))
  const clientDir = join(root, 'client')
  const serverDir = join(root, 'server')
  await mkdir(clientDir)
  await mkdir(serverDir)
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>test</title>')
  await writeFile(join(root, 'client-secret.txt'), 'must not be served')
  await writeFile(join(serverDir, 'actions.mjs'), 'export const registry = {}\n')
  await writeFile(join(serverDir, 'main-actions.mjs'), `
export const registry = {
  'src/services/main.ts': {
    async nodeVersion(value) {
      return { value, node: process.version, nodeEnv: process.env.NODE_ENV }
    },
    async lastSecondInstance() { return globalThis.__secondInstance },
    async lastOpenRequest() { return globalThis.__openRequest },
    async publish(channel, value) {
      const key = Symbol.for('murasaki.main.events.v1')
      const bus = globalThis[key] ??= { listeners: new Set() }
      for (const listener of bus.listeners) listener({ channel, value })
    },
  },
}
`)
  await writeFile(join(serverDir, 'main.mjs'), `
export default {
  ready(context) { globalThis.__mainReady = context.isPackaged },
  secondInstance(_context, event) { globalThis.__secondInstance = event },
  openRequested(_context, event) { globalThis.__openRequest = event },
  beforeQuit({ reason }) { return reason === 'restart' ? false : undefined },
  shutdown() { globalThis.__mainShutdown = true },
}
`)
  await writeFile(
    join(serverDir, 'routes.mjs'),
    `
const encoder = new TextEncoder()
const handlers = {
  async POST(request) {
    return new Response(await request.text(), { headers: { 'content-type': 'text/plain' } })
  },
  GET() {
    let timer
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('first\\n'))
        timer = setTimeout(() => {
          controller.enqueue(encoder.encode('second\\n'))
          controller.close()
        }, 150)
      },
      cancel() { clearTimeout(timer) },
    })
    const headers = new Headers({ 'content-type': 'text/event-stream' })
    headers.append('set-cookie', 'one=1; Path=/; HttpOnly')
    headers.append('set-cookie', 'two=2; Path=/; SameSite=Lax')
    return new Response(body, { headers })
  },
  HEAD() {
    return new Response('must-not-be-sent', { headers: { 'x-head': 'yes' } })
  },
}
export const routes = [{
  pattern: '/api/stream',
  regexSource: '^/api/stream/?$',
  paramNames: [],
  paramKinds: [],
  specificity: 100,
  handlers,
}]
`,
  )
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
      '--main-registry', join(serverDir, 'main-actions.mjs'),
      '--routes', join(serverDir, 'routes.mjs'),
      '--main', join(serverDir, 'main.mjs'),
      '--port', '0',
    ],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: '',
        HOME: root,
        XDG_DATA_HOME: join(root, 'xdg-data'),
        XDG_CACHE_HOME: join(root, 'xdg-cache'),
        XDG_STATE_HOME: join(root, 'xdg-state'),
      },
    },
  )
  t.after(async () => {
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), new Promise((resolveOk) => setTimeout(resolveOk, 1000))])
    await rm(root, { recursive: true, force: true })
  })

  const rl = createInterface({ input: child.stdout })
  const port = await new Promise((resolveOk, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not report a port')), 5000)
    rl.on('line', (line) => {
      const match = /^MURASAKI_PORT=(\d+)$/.exec(line)
      if (!match) return
      clearTimeout(timeout)
      resolveOk(Number(match[1]))
    })
    child.once('exit', (code) => reject(new Error(`server exited early (${code})`)))
  })
  const url = `http://127.0.0.1:${port}/api/stream`
  const bootstrap = await fetch(`http://127.0.0.1:${port}/`)
  const runtimeCookie = bootstrap.headers.getSetCookie()[0].split(';', 1)[0]
  const runtimeHeaders = { cookie: runtimeCookie }
  const nativeHeaders = {
    ...runtimeHeaders,
    'x-murasaki-native-token': runtimeCookie.slice(runtimeCookie.indexOf('=') + 1),
  }

  const escapedStatic = await fetch(
    `http://127.0.0.1:${port}/%2e%2e%2fclient-secret.txt`,
  )
  assert.equal(escapedStatic.status, 403)

  const forbidden = await fetch(url)
  assert.equal(forbidden.status, 403)

  const response = await fetch(url, { headers: runtimeHeaders })
  assert.equal(response.status, 200)
  assert.deepEqual(response.headers.getSetCookie(), [
    'one=1; Path=/; HttpOnly',
    'two=2; Path=/; SameSite=Lax',
  ])
  const reader = response.body.getReader()
  const first = await reader.read()
  assert.equal(new TextDecoder().decode(first.value), 'first\n')
  const second = await reader.read()
  assert.equal(new TextDecoder().decode(second.value), 'second\n')

  const echoBody = 'x'.repeat(256 * 1024)
  const echo = await fetch(url, { method: 'POST', body: echoBody, headers: runtimeHeaders })
  assert.equal(await echo.text(), echoBody)

  const head = await fetch(url, { method: 'HEAD', headers: runtimeHeaders })
  assert.equal(head.headers.get('x-head'), 'yes')
  assert.equal(await head.text(), '')

  const mainCall = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/call/${encodeURIComponent('src/services/main.ts')}/nodeVersion`,
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [99n] }),
    },
  )
  const mainPayload = parseWire(await mainCall.text())
  assert.equal(mainPayload.ok, true)
  assert.equal(mainPayload.value.value, 99n)
  assert.match(mainPayload.value.node, /^v/)
  assert.equal(mainPayload.value.nodeEnv, 'production')

  const secondInstance = await fetch(`http://127.0.0.1:${port}/__murasaki/main/second-instance`, {
    method: 'POST',
    headers: { ...nativeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ argv: ['murasaki://open/42'], cwd: '/tmp' }),
  })
  assert.equal(secondInstance.status, 204)
  const secondState = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/call/${encodeURIComponent('src/services/main.ts')}/lastSecondInstance`,
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [] }),
    },
  )
  assert.deepEqual(parseWire(await secondState.text()).value, {
    argv: ['murasaki://open/42'],
    cwd: '/tmp',
  })

  const openRequest = {
    activation: 'cold-start',
    transport: 'argv',
    targets: [{ kind: 'url', url: 'violet://open/42', scheme: 'violet' }],
    cwd: '/tmp',
  }
  const opened = await fetch(`http://127.0.0.1:${port}/__murasaki/main/open-request`, {
    method: 'POST',
    headers: { ...nativeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(openRequest),
  })
  assert.equal(opened.status, 204)
  const openState = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/call/${encodeURIComponent('src/services/main.ts')}/lastOpenRequest`,
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [] }),
    },
  )
  assert.deepEqual(parseWire(await openState.text()).value, openRequest)

  const invalidOpen = await fetch(`http://127.0.0.1:${port}/__murasaki/main/open-request`, {
    method: 'POST',
    headers: { ...nativeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ ...openRequest, targets: [{ kind: 'url', url: 'not a url', scheme: 'violet' }] }),
  })
  assert.equal(invalidOpen.status, 400)

  const rendererForgedOpen = await fetch(`http://127.0.0.1:${port}/__murasaki/main/open-request`, {
    method: 'POST',
    headers: { ...runtimeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(openRequest),
  })
  assert.equal(rendererForgedOpen.status, 403)

  const eventResponse = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/events?channel=relay.status`,
    { headers: runtimeHeaders },
  )
  assert.equal(eventResponse.status, 200)
  assert.match(eventResponse.headers.get('content-type'), /^text\/event-stream/)
  const eventReader = eventResponse.body.getReader()
  const decoder = new TextDecoder()
  let eventText = decoder.decode((await eventReader.read()).value, { stream: true })

  const publishEvent = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/call/${encodeURIComponent('src/services/main.ts')}/publish`,
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: ['relay.status', { count: 99n }] }),
    },
  )
  assert.equal(publishEvent.status, 200)
  while (!eventText.includes('data: ')) {
    const next = await eventReader.read()
    assert.equal(next.done, false)
    eventText += decoder.decode(next.value, { stream: true })
  }
  const eventLine = eventText.split('\n').find((line) => line.startsWith('data: '))
  const eventEnvelope = JSON.parse(eventLine.slice('data: '.length))
  assert.deepEqual(parseWire(eventEnvelope.payload), { count: 99n })
  await eventReader.cancel()

  const shutdown = await fetch(`http://127.0.0.1:${port}/__murasaki/main/shutdown`, {
    method: 'POST',
    headers: { ...nativeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'app-quit' }),
  })
  assert.deepEqual(await shutdown.json(), { cancelled: false, timedOut: false })
})
