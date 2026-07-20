import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { parseWire, stringifyWire, WIRE_CONTENT_TYPE } from '../dist/runtime/wire.js'
import { deriveWindowToken } from '../dist/runtime/window-auth.js'
import { DEFAULT_PRODUCTION_CSP } from '../dist/vite-plugin/shell.js'

const packageDir = resolve(import.meta.dirname, '..')
const RUNTIME_TOKEN = 'a'.repeat(64)

async function copyMainRuntimeFixture(root) {
  const runtimeRoot = join(root, '.murasaki-runtime')
  const runtimeDir = join(runtimeRoot, 'runtime')
  const mainDir = join(runtimeRoot, 'main')
  await mkdir(runtimeDir, { recursive: true })
  await mkdir(mainDir, { recursive: true })
  await Promise.all([
    copyFile(join(packageDir, 'dist/runtime/main-runtime.js'), join(runtimeDir, 'main-runtime.js')),
    copyFile(join(packageDir, 'dist/runtime/launch.js'), join(runtimeDir, 'launch.js')),
    copyFile(join(packageDir, 'dist/main/logger.js'), join(mainDir, 'logger.js')),
    copyFile(join(packageDir, 'dist/main/sidecar.js'), join(mainDir, 'sidecar.js')),
    copyFile(join(packageDir, 'dist/main/crash-reports.js'), join(mainDir, 'crash-reports.js')),
    writeFile(join(runtimeRoot, 'package.json'), '{"private":true,"type":"module"}\n'),
  ])
}

/**
 * Minimal prod-server.mjs fixture (no server actions/routes exercised) —
 * used by the CSP header tests below, which only care about the metadata →
 * response-header plumbing (`murasaki-meta.json`'s `csp` field, written by
 * cli/bundle.ts's metaJson() from the same resolveContentSecurityPolicy()
 * the dev middleware and the meta tag use). A real bundle always writes this
 * key, so the default here mirrors that — never omit it.
 */
async function startMinimalProdServer(t, { csp = DEFAULT_PRODUCTION_CSP, omitCsp = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-prod-csp-'))
  const clientDir = join(root, 'client')
  const serverDir = join(root, 'server')
  await mkdir(clientDir)
  await mkdir(serverDir)
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>csp test</title>')
  await writeFile(join(clientDir, 'app.js'), 'export {}\n')
  await writeFile(join(serverDir, 'actions.mjs'), 'export const registry = {}\n')
  await writeFile(join(serverDir, 'main-actions.mjs'), 'export const registry = {}\n')
  await writeFile(join(serverDir, 'routes.mjs'), 'export const routes = []\n')
  await writeFile(join(serverDir, 'main.mjs'), 'export default {}\n')
  await copyFile(join(packageDir, 'assets/prod-server.mjs'), join(root, 'prod-server.mjs'))
  await copyFile(join(packageDir, 'dist/runtime/updater.js'), join(root, 'updater-engine.mjs'))
  await copyFile(join(packageDir, 'dist/runtime/wire.js'), join(root, 'wire.mjs'))
  await copyMainRuntimeFixture(root)
  await writeFile(join(root, 'murasaki-meta.json'), JSON.stringify({
    appId: 'dev.murasaki.prod-csp-test',
    productName: 'Production CSP test',
    windows: [{ label: 'main', backendCapabilities: [] }],
    ...(omitCsp ? {} : { csp }),
  }))

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
        MURASAKI_RUNTIME_TOKEN: RUNTIME_TOKEN,
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
  return port
}

test('production API server streams requests/responses and preserves HTTP semantics', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-prod-http-'))
  const clientDir = join(root, 'client')
  const serverDir = join(root, 'server')
  await mkdir(clientDir)
  await mkdir(serverDir)
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>test</title>')
  await writeFile(join(root, 'client-secret.txt'), 'must not be served')
  let symlinkFixture = true
  try { await symlink(join(root, 'client-secret.txt'), join(clientDir, 'leak.txt')) }
  catch (error) {
    if (process.platform === 'win32' && error?.code === 'EPERM') symlinkFixture = false
    else throw error
  }
  await writeFile(join(serverDir, 'actions.mjs'), 'export const registry = {}\n')
  await writeFile(join(serverDir, 'main-actions.mjs'), `
export const registry = {
  'src/services/main.ts': {
    async nodeVersion(value) {
      return { value, node: process.version, nodeEnv: process.env.NODE_ENV }
    },
    async lastSecondInstance() { return globalThis.__secondInstance },
    async lastOpenRequest() { return globalThis.__openRequest },
    async lastLaunch() { return globalThis.__launch },
    requestWindow(method, label) {
      const key = Symbol.for('murasaki.main.window-control.v1')
      const bus = globalThis[key] ??= {
        version: 1, nextId: 1, phase: 'running', commands: [],
        pending: new Map(), listeners: new Set(),
      }
      const id = 'fixture-' + bus.nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fixture window timeout')), 2000)
        bus.pending.set(id, { resolve, reject, timer })
        bus.commands.push({ id, method, ...(label === undefined ? {} : { label }) })
      })
    },
    subscribeWindows() {
      const key = Symbol.for('murasaki.main.window-control.v1')
      const bus = globalThis[key] ??= {
        version: 1, nextId: 1, phase: 'running', commands: [],
        pending: new Map(), listeners: new Set(),
      }
      bus.listeners.add((event) => { globalThis.__lastWindowEvent = event })
    },
    lastWindowEvent() { return globalThis.__lastWindowEvent },
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
  ready(context) { globalThis.__mainReady = context.isPackaged; globalThis.__launch = context.launch },
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
  await copyMainRuntimeFixture(root)
  await writeFile(join(root, 'murasaki-meta.json'), JSON.stringify({
    appId: 'dev.murasaki.prod-http-test',
    productName: 'Production HTTP test',
    windows: [{
      label: 'main',
      backendCapabilities: ['main:*', 'action:*', 'api:*', 'updater:*', 'events:*', 'diagnostics:*'],
    }, {
      label: 'preview',
      backendCapabilities: [],
    }],
  }))
  const launchFile = join(root, 'launch.json')
  await writeFile(launchFile, JSON.stringify({ argv: ['--no-sample-data'], cwd: '/fixture-cwd' }))

  // Hold the requested port and several deterministic fallback candidates to
  // verify that packaged launches escape a contiguous Windows excluded range
  // without accumulating stale EventEmitter listeners. The native launcher
  // persists the reported fallback for subsequent stable-origin launches.
  const occupied = createServer()
  occupied.listen(0, '127.0.0.1')
  await once(occupied, 'listening')
  const occupiedPort = occupied.address().port
  const occupiedPorts = new Set([occupiedPort])
  const occupiedServers = [occupied]
  const nextPrivatePort = (current) => {
    const first = 49_152
    const count = 16_384
    const offset = current >= first && current < first + count ? current - first : 0
    return first + ((offset + 521) % count)
  }
  let candidate = occupiedPort
  for (let attempt = 0; attempt < 11; attempt += 1) {
    candidate = nextPrivatePort(candidate)
    occupiedPorts.add(candidate)
    const blocker = createServer()
    const bound = await new Promise((resolveOk, reject) => {
      blocker.once('error', (error) => {
        if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') resolveOk(false)
        else reject(error)
      })
      blocker.listen(candidate, '127.0.0.1', () => resolveOk(true))
    })
    if (bound) occupiedServers.push(blocker)
  }
  t.after(() => {
    for (const server of occupiedServers) server.close()
  })

  const child = spawn(
    process.execPath,
    [
      join(root, 'prod-server.mjs'),
      '--client', clientDir,
      '--registry', join(serverDir, 'actions.mjs'),
      '--main-registry', join(serverDir, 'main-actions.mjs'),
      '--routes', join(serverDir, 'routes.mjs'),
      '--main', join(serverDir, 'main.mjs'),
      '--launch-file', launchFile,
      '--port', String(occupiedPort),
      '--port-attempts', '16',
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
        MURASAKI_RUNTIME_TOKEN: RUNTIME_TOKEN,
      },
    },
  )
  let childStderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { childStderr += chunk })
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
  assert.equal(occupiedPorts.has(port), false)
  assert.doesNotMatch(childStderr, /MaxListenersExceededWarning/)
  const bootstrap = await fetch(`http://127.0.0.1:${port}/`)
  assert.deepEqual(bootstrap.headers.getSetCookie(), [])
  assert.equal(
    bootstrap.headers.get('permissions-policy'),
    'camera=(), microphone=(), geolocation=()',
  )
  const runtimeHeaders = {
    'x-murasaki-window-label': 'main',
    'x-murasaki-window-generation': '1',
    'x-murasaki-window-token': deriveWindowToken(RUNTIME_TOKEN, 'main'),
  }
  const nativeHeaders = {
    'x-murasaki-native-token': RUNTIME_TOKEN,
  }
  const previewHeaders = {
    'x-murasaki-window-label': 'preview',
    'x-murasaki-window-generation': '1',
    'x-murasaki-window-token': deriveWindowToken(RUNTIME_TOKEN, 'preview'),
  }
  await assert.rejects(access(launchFile))

  const escapedStatic = await fetch(
    `http://127.0.0.1:${port}/%2e%2e%2fclient-secret.txt`,
  )
  assert.equal(escapedStatic.status, 403)
  if (symlinkFixture) {
    const symlinkEscape = await fetch(`http://127.0.0.1:${port}/leak.txt`)
    assert.equal(symlinkEscape.status, 403)
    assert.doesNotMatch(await symlinkEscape.text(), /must not be served/)
  }
  const malformedStatic = await fetch(`http://127.0.0.1:${port}/%E0%A4%A`)
  assert.equal(malformedStatic.status, 400)

  const forbidden = await fetch(url)
  assert.equal(forbidden.status, 403)

  const deniedPreview = await fetch(url, { headers: previewHeaders })
  assert.equal(deniedPreview.status, 403)

  const forgedMain = await fetch(url, {
    headers: {
      'x-murasaki-window-label': 'main',
      'x-murasaki-window-generation': '1',
      'x-murasaki-window-token': previewHeaders['x-murasaki-window-token'],
    },
  })
  assert.equal(forgedMain.status, 403)

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

  const launchCall = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/call/${encodeURIComponent('src/services/main.ts')}/lastLaunch`,
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [] }),
    },
  )
  assert.deepEqual(parseWire(await launchCall.text()).value, {
    argv: ['--no-sample-data'],
    cwd: '/fixture-cwd',
  })

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

  const requestWindow = fetch(
    `http://127.0.0.1:${port}/__murasaki/main/call/${encodeURIComponent('src/services/main.ts')}/requestWindow`,
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: ['get', 'settings'] }),
    },
  )
  await new Promise((resolveOk) => setTimeout(resolveOk, 20))
  const rendererForgedWindowPoll = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/windows/commands`,
    { headers: runtimeHeaders },
  )
  assert.equal(rendererForgedWindowPoll.status, 403)
  const windowCommands = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/windows/commands`,
    { headers: nativeHeaders },
  )
  const [windowCommand] = await windowCommands.json()
  assert.deepEqual(
    { method: windowCommand.method, label: windowCommand.label },
    { method: 'get', label: 'settings' },
  )
  const nativeWindowState = {
    label: 'settings', generation: 4, primary: false, visible: false, focused: false,
    minimized: false, maximized: false,
  }
  const windowResult = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/windows/result`,
    {
      method: 'POST',
      headers: { ...nativeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ id: windowCommand.id, ok: true, value: nativeWindowState }),
    },
  )
  assert.equal(windowResult.status, 204)
  assert.deepEqual(parseWire(await (await requestWindow).text()).value, nativeWindowState)

  const subscribeWindows = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/call/${encodeURIComponent('src/services/main.ts')}/subscribeWindows`,
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [] }),
    },
  )
  assert.equal(subscribeWindows.status, 200)
  const windowEvent = {
    type: 'created', label: 'settings', generation: 4, primary: false, state: nativeWindowState,
  }
  const publishedWindowEvent = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/windows/event`,
    {
      method: 'POST',
      headers: { ...nativeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(windowEvent),
    },
  )
  assert.equal(publishedWindowEvent.status, 204)
  const invalidWindowEvent = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/windows/event`,
    {
      method: 'POST',
      headers: { ...nativeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ ...windowEvent, generation: 5 }),
    },
  )
  assert.equal(invalidWindowEvent.status, 400)
  for (const invalidEvent of [
    { ...windowEvent, state: null },
    { ...windowEvent, type: 'closed' },
  ]) {
    const response = await fetch(
      `http://127.0.0.1:${port}/__murasaki/main/windows/event`,
      {
        method: 'POST',
        headers: { ...nativeHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(invalidEvent),
      },
    )
    assert.equal(response.status, 400)
  }
  const lastWindowEvent = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/call/${encodeURIComponent('src/services/main.ts')}/lastWindowEvent`,
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'content-type': WIRE_CONTENT_TYPE },
      body: await stringifyWire({ args: [] }),
    },
  )
  assert.deepEqual(parseWire(await lastWindowEvent.text()).value, windowEvent)
  const closedWindowEvent = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/windows/event`,
    {
      method: 'POST',
      headers: { ...nativeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'closed', label: 'settings', generation: 4, primary: false, state: null,
      }),
    },
  )
  assert.equal(closedWindowEvent.status, 204)

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

  // Window authority is live-generation scoped. A credential injected into a
  // closed WebView stays invalid after the same label is recreated.
  const closeMain = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/windows/event`,
    {
      method: 'POST',
      headers: { ...nativeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'closed', label: 'main', generation: 1, primary: true, state: null,
      }),
    },
  )
  assert.equal(closeMain.status, 204)
  const staleWindowRequest = await fetch(url, { headers: runtimeHeaders })
  assert.equal(staleWindowRequest.status, 403)

  const recreatedMainState = {
    label: 'main', generation: 2, primary: true, visible: true, focused: true,
    minimized: false, maximized: false,
  }
  const recreateMain = await fetch(
    `http://127.0.0.1:${port}/__murasaki/main/windows/event`,
    {
      method: 'POST',
      headers: { ...nativeHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'created', label: 'main', generation: 2, primary: true, state: recreatedMainState,
      }),
    },
  )
  assert.equal(recreateMain.status, 204)
  const generationTwoHeaders = {
    'x-murasaki-window-label': 'main',
    'x-murasaki-window-generation': '2',
    'x-murasaki-window-token': deriveWindowToken(RUNTIME_TOKEN, 'main', 2),
  }
  const generationTwoRequest = await fetch(url, { headers: generationTwoHeaders })
  assert.equal(generationTwoRequest.status, 200)
  await generationTwoRequest.body.cancel()

  const shutdown = await fetch(`http://127.0.0.1:${port}/__murasaki/main/shutdown`, {
    method: 'POST',
    headers: { ...nativeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'app-quit' }),
  })
  assert.deepEqual(await shutdown.json(), { cancelled: false, timedOut: false })
})

test('production server sets the resolved production CSP header, incl. frame-ancestors, on served HTML only', async (t) => {
  const port = await startMinimalProdServer(t)
  const html = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(html.headers.get('content-security-policy'), DEFAULT_PRODUCTION_CSP)
  assert.match(DEFAULT_PRODUCTION_CSP, /frame-ancestors 'none'/)

  // Subresources don't need CSP — same doc-only gate as the dev middleware.
  const asset = await fetch(`http://127.0.0.1:${port}/app.js`)
  assert.equal(asset.headers.get('content-security-policy'), null)
})

test('production server suppresses the CSP header when security.csp resolved to false at bundle time', async (t) => {
  const port = await startMinimalProdServer(t, { csp: false })
  const html = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(html.headers.get('content-security-policy'), null)
})

test('production server emits a user-supplied CSP override delivered through murasaki-meta.json byte-identical', async (t) => {
  const custom = "default-src 'none'; connect-src https://api.example.test"
  const port = await startMinimalProdServer(t, { csp: custom })
  const html = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(html.headers.get('content-security-policy'), custom)
})

test('production server sends no CSP header when murasaki-meta.json has no csp field (standalone run, not a real bundle)', async (t) => {
  const port = await startMinimalProdServer(t, { omitCsp: true })
  const html = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(html.headers.get('content-security-policy'), null)
})
