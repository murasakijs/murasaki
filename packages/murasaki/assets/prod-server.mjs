#!/usr/bin/env node
// murasaki production server — serves the built client (dist/client), runs
// 'use server' actions out of the registry built by cli/build-server.ts
// (dist/server/actions.mjs), dispatches `src/api/**/route.ts` handlers out of
// the parallel routes registry (dist/server/routes.mjs), and answers the
// auto-updater's `/__murasaki/update/*` routes (contract §6). This is the
// prod counterpart of Vite's dev server + the dev middlewares in
// src/vite-plugin/server-actions.ts, src/vite-plugin/api-routes.ts, and
// src/vite-plugin/updater.ts: the client's
// `fetch('/__murasaki/action/<id>/<name>')` stub, `/api/*` requests, and the
// updater's routes are identical in both, so this process only needs to
// answer the same shapes Vite's dev middlewares do (static files, POST
// /__murasaki/action/…, /api/…, and /__murasaki/update/…).
//
// `cli/bundle.ts` copies this file PLUS `dist/runtime/updater.js` (renamed to
// `updater-engine.mjs`) into the packaged resources dir, and this file
// imports it below. Unlike handleAction/handleApiRoute, which hand-mirror
// (never import) vite-plugin/server-actions.ts/api-routes.ts, the updater
// engine — including the Ed25519 manifest signature verification that is
// this feature's entire security model — has exactly ONE implementation,
// `src/runtime/updater.ts`, shared by dev (src/vite-plugin/updater.ts) and
// prod (here). Do not reintroduce a second copy of it in this file.
//
// Run standalone for testing (`node prod-server.mjs --client <dir> --registry
// <path> --routes <path> --port <n>`) or spawned by assets/prod-launcher.mjs,
// which reads the assigned port off a `MURASAKI_PORT=<n>` line printed to
// stdout once the server is listening (see prod-launcher.mjs's waitForPort).
import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { createUpdateRequestHandler, createUpdaterEngine } from './updater-engine.mjs'
import { MainRuntime } from './.murasaki-runtime/runtime/main-runtime.js'
import {
  MAX_WIRE_PAYLOAD_BYTES,
  parseWire,
  stringifyWire,
  WIRE_CONTENT_TYPE,
} from './wire.mjs'

// Match normal production Node frameworks. The packaged launcher inherits
// user-defined environment variables, but apps and external dependencies
// still need a reliable mode even when launched from Finder/Explorer rather
// than a shell that set NODE_ENV.
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production'

const ACTION_PATH_PREFIX = '/__murasaki/action/'
const MAIN_CALL_PREFIX = '/__murasaki/main/call/'
const API_PATH_PREFIX = '/api/'
const UPDATE_PATH_PREFIX = '/__murasaki/update/'
const MAIN_SHUTDOWN_PATH = '/__murasaki/main/shutdown'
const MAIN_SECOND_INSTANCE_PATH = '/__murasaki/main/second-instance'
const MAIN_OPEN_REQUEST_PATH = '/__murasaki/main/open-request'
const MAIN_EVENTS_PATH = '/__murasaki/main/events'
const MAIN_WINDOW_COMMANDS_PATH = '/__murasaki/main/windows/commands'
const MAIN_WINDOW_RESULT_PATH = '/__murasaki/main/windows/result'
const MAIN_WINDOW_EVENT_PATH = '/__murasaki/main/windows/event'
const RUNTIME_COOKIE = 'murasaki_runtime'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

const { clientDir, registryPath, mainRegistryPath, routesPath, mainPath, port } = parseArgs()
let listeningPort = port
const runtimeToken = process.env.MURASAKI_RUNTIME_TOKEN ?? randomBytes(32).toString('hex')

let registryPromise
function loadRegistry() {
  if (!registryPromise) {
    registryPromise = import(pathToFileURL(registryPath).href).then((m) => m.registry ?? {})
  }
  return registryPromise
}

let mainRegistryPromise
function loadMainRegistry() {
  if (!mainRegistryPromise) {
    mainRegistryPromise = import(pathToFileURL(mainRegistryPath).href).then((m) => m.registry ?? {})
  }
  return mainRegistryPromise
}

let routesPromise
function loadRoutes() {
  if (!routesPromise) {
    routesPromise = import(pathToFileURL(routesPath).href).then((m) => m.routes ?? [])
  }
  return routesPromise
}

// murasaki-meta.json — read once at startup from cwd. The launcher already
// sets cwd = the resources dir before spawning this process (see
// crates/native/src/launcher.rs's `current_dir(resources_dir)`), so
// `resolve('murasaki-meta.json')` here lands on the same file `read_meta`
// reads on the Rust side. Missing/unparsable (e.g. this file run standalone
// per the header comment above) is tolerated — the updater engine below just
// degrades to "not configured" rather than crashing the whole server.
let meta = {}
try {
  meta = JSON.parse(await readFile(resolve(process.cwd(), 'murasaki-meta.json'), 'utf8'))
} catch {}

// `meta.updater`, when present, is already the fully-resolved shape
// (`ResolvedUpdater` — manifestUrl/publicKey/channel/checkOnStart/
// checkIntervalMs) written by `cli/bundle.ts`'s `metaJson()` via
// `resolveUpdater()` — this process never re-derives a GitHub URL or reads
// `.murasaki/update-key.pub` itself. `currentVersion` is `meta.version`
// (config.version at bundle time), NOT `@murasakijs/native`'s `version()` —
// that returns the native crate's own version, a different number entirely.
const updateEngine = createUpdaterEngine({
  resolvedUpdater: meta.updater ?? null,
  currentVersion: meta.version ?? '0.0.0',
  mode: 'prod',
  resourcesDir: process.cwd(),
})
const handleUpdateRequest = createUpdateRequestHandler(updateEngine)

const mainRuntime = new MainRuntime({
  appId: meta.appId ?? meta.productName ?? 'murasaki-app',
  productName: meta.productName ?? 'Murasaki',
  version: meta.version ?? '0.0.0',
  projectRoot: process.cwd(),
  resourcesPath: process.cwd(),
  isPackaged: true,
  shutdownTimeoutMs: meta.mainShutdownTimeoutMs,
})
await mainRuntime.start(() => import(pathToFileURL(mainPath).href))

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    if (!res.headersSent) res.statusCode = 500
    res.end(`internal error: ${err?.message ?? err}`)
  })
})

async function handleRequest(req, res) {
  const pathname = (req.url ?? '/').split('?')[0]
  const isApiPath = pathname === '/api' || pathname.startsWith(API_PATH_PREFIX)
  const isPrivileged = pathname.startsWith(ACTION_PATH_PREFIX)
    || pathname.startsWith(MAIN_CALL_PREFIX)
    || isApiPath
    || pathname.startsWith(UPDATE_PATH_PREFIX)
    || pathname === MAIN_SHUTDOWN_PATH
    || pathname === MAIN_SECOND_INSTANCE_PATH
    || pathname === MAIN_OPEN_REQUEST_PATH
    || pathname === MAIN_EVENTS_PATH
    || pathname === MAIN_WINDOW_COMMANDS_PATH
    || pathname === MAIN_WINDOW_RESULT_PATH
    || pathname === MAIN_WINDOW_EVENT_PATH
  if (isPrivileged && !isAuthorizedRuntimeRequest(req)) {
    res.statusCode = 403
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ error: 'forbidden runtime request' }))
    return
  }
  const isNativeOnly = pathname === MAIN_SHUTDOWN_PATH
    || pathname === MAIN_SECOND_INSTANCE_PATH
    || pathname === MAIN_OPEN_REQUEST_PATH
    || pathname === MAIN_WINDOW_COMMANDS_PATH
    || pathname === MAIN_WINDOW_RESULT_PATH
    || pathname === MAIN_WINDOW_EVENT_PATH
  if (isNativeOnly && !isAuthorizedNativeRequest(req)) {
    res.statusCode = 403
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ error: 'forbidden native request' }))
    return
  }
  if (req.method === 'POST' && req.url?.startsWith(ACTION_PATH_PREFIX)) {
    return handleAction(req, res)
  }
  if (req.method === 'POST' && req.url?.startsWith(MAIN_CALL_PREFIX)) {
    return handleRegistryCall(req, res, MAIN_CALL_PREFIX, loadMainRegistry, 'main function')
  }
  if (req.method === 'POST' && pathname === MAIN_SHUTDOWN_PATH) {
    return handleMainShutdown(req, res)
  }
  if (req.method === 'POST' && pathname === MAIN_SECOND_INSTANCE_PATH) {
    return handleSecondInstance(req, res)
  }
  if (req.method === 'POST' && pathname === MAIN_OPEN_REQUEST_PATH) {
    return handleOpenRequest(req, res)
  }
  if (req.method === 'GET' && pathname === MAIN_EVENTS_PATH) {
    return handleMainEvents(req, res)
  }
  if (req.method === 'GET' && pathname === MAIN_WINDOW_COMMANDS_PATH) {
    return handleMainWindowCommands(res)
  }
  if (req.method === 'POST' && pathname === MAIN_WINDOW_RESULT_PATH) {
    return handleMainWindowResult(req, res)
  }
  if (req.method === 'POST' && pathname === MAIN_WINDOW_EVENT_PATH) {
    return handleMainWindowEvent(req, res)
  }
  if (pathname.startsWith(UPDATE_PATH_PREFIX)) {
    await handleUpdateRequest(req, res)
    return
  }
  if (isApiPath) {
    return handleApiRoute(req, res, pathname)
  }
  return serveStatic(req, res)
}

function mainWindowControlBus() {
  return globalThis[Symbol.for('murasaki.main.window-control.v1')]
}

function handleMainWindowCommands(res) {
  const bus = mainWindowControlBus()
  const commands = []
  while (commands.length < 32 && bus?.commands?.length > 0) {
    const command = bus.commands.shift()
    if (command && bus.pending?.has(command.id)) commands.push(command)
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(commands))
}

async function handleMainWindowResult(req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    body = null
  }
  if (!body || typeof body.id !== 'string' || body.id.length > 64 || typeof body.ok !== 'boolean'
    || (!body.ok && (typeof body.error !== 'string' || body.error.length > 4096))) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid native window result' }))
    return
  }
  const bus = mainWindowControlBus()
  const pending = bus?.pending?.get(body.id)
  if (pending) {
    bus.pending.delete(body.id)
    clearTimeout(pending.timer)
    if (body.ok) pending.resolve(body.value)
    else pending.reject(new Error(body.error))
  }
  res.statusCode = 204
  res.setHeader('cache-control', 'no-store')
  res.end()
}

async function handleMainWindowEvent(req, res) {
  let event
  try {
    event = JSON.parse(await readBody(req))
  } catch {
    event = null
  }
  const types = new Set(['created', 'shown', 'hidden', 'focused', 'blurred', 'closed'])
  const stateValid = event?.type === 'closed'
    ? event?.state === null
    : (event?.state && typeof event.state === 'object'
    && event.state.label === event.label
    && event.state.generation === event.generation
    && typeof event.state.primary === 'boolean'
    && ['visible', 'focused', 'minimized', 'maximized']
      .every((field) => typeof event.state[field] === 'boolean'))
  if (!event || !types.has(event.type)
    || typeof event.label !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(event.label)
    || !Number.isSafeInteger(event.generation) || event.generation < 1
    || typeof event.primary !== 'boolean' || !stateValid) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid native window lifecycle event' }))
    return
  }
  const bus = mainWindowControlBus()
  if (bus?.listeners) {
    for (const listener of bus.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('murasaki: window lifecycle listener failed:', error)
      }
    }
  }
  res.statusCode = 204
  res.setHeader('cache-control', 'no-store')
  res.end()
}

function handleMainEvents(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${listeningPort}`)
  const channel = url.searchParams.get('channel') ?? ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(channel)) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid main event channel' }))
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', 'text/event-stream')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('connection', 'keep-alive')
  res.write(': connected\n\n')

  const key = Symbol.for('murasaki.main.events.v1')
  const bus = globalThis[key] ??= { listeners: new Set() }
  let writes = Promise.resolve()
  const listener = (event) => {
    if (event.channel !== channel) return
    writes = writes.then(async () => {
      if (!res.destroyed) {
        const payload = await stringifyWire(event.value)
        res.write(`data: ${JSON.stringify({ payload })}\n\n`)
      }
    }).catch(() => {})
  }
  bus.listeners.add(listener)
  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(': heartbeat\n\n')
  }, 15_000)
  heartbeat.unref?.()
  req.on('close', () => {
    clearInterval(heartbeat)
    bus.listeners.delete(listener)
  })
}

async function handleSecondInstance(req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    body = null
  }
  if (!body || !Array.isArray(body.argv) || !body.argv.every((value) => typeof value === 'string')
    || typeof body.cwd !== 'string') {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid second-instance event' }))
    return
  }
  void mainRuntime.secondInstance({ argv: body.argv, cwd: body.cwd }).catch((error) => {
    console.error('murasaki: secondInstance handler failed:', error)
  })
  res.statusCode = 204
  res.setHeader('cache-control', 'no-store')
  res.end()
}

async function handleOpenRequest(req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    body = null
  }
  const allowedActivations = new Set(['cold-start', 'second-instance', 'os-event'])
  const allowedTransports = new Set(['argv', 'open-url', 'open-file'])
  const targetsValid = Array.isArray(body?.targets)
    && body.targets.length > 0
    && body.targets.length <= 32
    && body.targets.every((target) => {
      if (!target || typeof target !== 'object') return false
      if (target.kind === 'url') {
        if (typeof target.url !== 'string' || target.url.length === 0 || target.url.length > 8192
          || typeof target.scheme !== 'string' || target.scheme.length === 0 || target.scheme.length > 64) return false
        try {
          return new URL(target.url).protocol.slice(0, -1).toLowerCase() === target.scheme.toLowerCase()
        } catch {
          return false
        }
      }
      return target.kind === 'file'
        && typeof target.path === 'string'
        && target.path.length > 0
        && target.path.length <= 32_768
    })
  if (!body || !allowedActivations.has(body.activation) || !allowedTransports.has(body.transport)
    || !targetsValid || (body.cwd !== undefined && typeof body.cwd !== 'string')) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid open request' }))
    return
  }
  let delivery
  try {
    delivery = mainRuntime.openRequested({
      activation: body.activation,
      transport: body.transport,
      targets: body.targets,
      ...(body.cwd === undefined ? {} : { cwd: body.cwd }),
    })
  } catch (error) {
    res.statusCode = 503
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ error: error?.message ?? 'open request queue unavailable' }))
    return
  }
  void delivery.catch((error) => {
    console.error('murasaki: openRequested handler failed:', error)
  })
  res.statusCode = 204
  res.setHeader('cache-control', 'no-store')
  res.end()
}

async function handleMainShutdown(req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid shutdown request' }))
    return
  }
  const allowedReasons = new Set([
    'window-close', 'app-quit', 'signal', 'restart', 'dev-reload', 'startup-failure',
  ])
  if (!allowedReasons.has(body?.reason) || (body.force !== undefined && typeof body.force !== 'boolean')) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid shutdown options' }))
    return
  }
  const result = await mainRuntime.shutdown({ reason: body.reason, force: body.force === true })
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(result))
}

function isAuthorizedRuntimeRequest(req) {
  const expectedHost = `127.0.0.1:${listeningPort}`
  if (req.headers.host !== expectedHost) return false
  const origin = req.headers.origin
  if (origin !== undefined && origin !== `http://${expectedHost}`) return false

  const cookieHeader = req.headers.cookie ?? ''
  const token = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${RUNTIME_COOKIE}=`))
    ?.slice(RUNTIME_COOKIE.length + 1)
  if (!token) return false

  const received = Buffer.from(token)
  const expected = Buffer.from(runtimeToken)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

function isAuthorizedNativeRequest(req) {
  const token = req.headers['x-murasaki-native-token']
  if (typeof token !== 'string') return false
  const received = Buffer.from(token)
  const expected = Buffer.from(runtimeToken)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/** Mirrors the dev middleware's contract exactly (src/vite-plugin/server-actions.ts). */
async function handleAction(req, res) {
  return handleRegistryCall(req, res, ACTION_PATH_PREFIX, loadRegistry, 'server action')
}

async function handleRegistryCall(req, res, prefix, load, label) {
  const rest = req.url.slice(prefix.length)
  const sepIndex = rest.lastIndexOf('/')
  if (sepIndex === -1) {
    res.statusCode = 404
    res.end()
    return
  }

  const encodedId = rest.slice(0, sepIndex)
  const name = rest.slice(sepIndex + 1)
  let actionId
  try {
    actionId = decodeURIComponent(encodedId)
  } catch {
    await sendWireResponse(res, 400, {
      ok: false,
      error: new Error(`Invalid ${label} module id`),
    })
    return
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    await sendWireResponse(res, 404, {
      ok: false,
      error: new Error(`No such ${label}: ${name}`),
    })
    return
  }

  let args
  try {
    const body = await readBody(req)
    const parsed = parseWire(body)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.args)) {
      throw new Error('missing "args" array')
    }
    args = parsed.args
  } catch (err) {
    await sendWireResponse(res, 400, { ok: false, error: ensureError(err, 'Invalid request body') })
    return
  }

  try {
    const registry = await load()
    const mod = Object.hasOwn(registry, actionId) ? registry[actionId] : null
    const fn = mod && Object.hasOwn(mod, name) ? mod[name] : null
    if (typeof fn !== 'function') {
      await sendWireResponse(res, 404, {
        ok: false,
        error: new Error(`No such ${label}: ${name}`),
      })
      return
    }

    const result = await fn(...args)
    await sendWireResponse(res, 200, { ok: true, value: result })
  } catch (err) {
    await sendWireResponse(res, 500, { ok: false, error: ensureError(err) })
  }
}

function readBody(req) {
  return new Promise((resolveOk, rejectFail) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      const bytes = Buffer.from(chunk)
      size += bytes.byteLength
      if (size > MAX_WIRE_PAYLOAD_BYTES) {
        settled = true
        rejectFail(new Error(`Action payload exceeds ${MAX_WIRE_PAYLOAD_BYTES} bytes`))
        return
      }
      chunks.push(bytes)
    })
    req.on('end', () => {
      if (!settled) resolveOk(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (error) => {
      if (!settled) rejectFail(error)
    })
  })
}

async function sendWireResponse(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', WIRE_CONTENT_TYPE)
  res.setHeader('cache-control', 'no-store')
  try {
    res.end(await stringifyWire(payload))
  } catch (err) {
    res.statusCode = 500
    res.end(await stringifyWire({
      ok: false,
      error: ensureError(err, 'Failed to encode action response'),
    }))
  }
}

function ensureError(value, fallback = 'Server action failed') {
  if (value instanceof Error) return value
  const error = new Error(value === undefined ? fallback : String(value))
  Object.defineProperty(error, 'cause', { value, enumerable: false, configurable: true })
  return error
}

/** Mirrors the dev middleware's contract exactly (src/vite-plugin/api-routes.ts). */
async function handleApiRoute(req, res, pathname) {
  const routes = await loadRoutes()
  const match = matchApiRoute(routes, pathname)
  if (!match) {
    res.statusCode = 404
    res.end()
    return
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const handler = match.route.handlers[method]
  if (typeof handler !== 'function') {
    res.statusCode = 405
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: `no handler for ${method} ${pathname}` }))
    return
  }

  try {
    const request = await toWebRequest(req)
    const response = await handler(request, { params: match.params })
    await sendWebResponse(res, response, method === 'HEAD')
  } catch (err) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: String(err?.message ?? err) }))
  }
}

/**
 * Matches `pathname` against `routes` (as built by cli/build-server.ts's
 * `dist/server/routes.mjs`). Static segments win over dynamic ones — same
 * scoring as vite-plugin/api-routes.ts's `matchApiRoute`.
 */
function matchApiRoute(routes, pathname) {
  let best = null
  for (const route of routes) {
    const match = new RegExp(route.regexSource).exec(pathname)
    if (!match) continue
    const params = {}
    route.paramNames.forEach((name, i) => {
      const value = match[i + 1]
      const kind = route.paramKinds?.[i] ?? 'dynamic'
      if (kind === 'optionalCatchAll' && (value === undefined || value === '')) return
      params[name] = kind === 'dynamic'
        ? decodeURIComponent(value ?? '')
        : (value ?? '').split('/').map((segment) => decodeURIComponent(segment))
    })
    const score = route.specificity
      ?? (route.pattern.split('/').filter(Boolean).length - route.paramNames.length)
    if (!best || score > best.score) best = { route, params, score }
  }
  return best ? { route: best.route, params: best.params } : null
}

/** Node `IncomingMessage` → Web `Request`. Mirrors vite-plugin/api-routes.ts's `toWebRequest`. */
async function toWebRequest(req) {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  if (!hasBody) return new Request(url, { method, headers })
  return new Request(url, {
    method,
    headers,
    body: Readable.toWeb(req),
    duplex: 'half',
  })
}

/** Web `Response` → Node `ServerResponse`. Mirrors vite-plugin/api-routes.ts's `sendWebResponse`. */
async function sendWebResponse(res, response, headOnly = false) {
  res.statusCode = response.status
  const getSetCookie = response.headers.getSetCookie
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    res.setHeader(key, value)
  })
  const setCookies = typeof getSetCookie === 'function'
    ? getSetCookie.call(response.headers)
    : []
  if (setCookies.length > 0) res.setHeader('set-cookie', setCookies)

  if (headOnly || !response.body) {
    res.end()
    return
  }
  await pipeline(Readable.fromWeb(response.body), res)
}

/** Static files out of clientDir; any other GET falls back to index.html (SPA routing survives reload/deep links). */
async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end()
    return
  }

  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
  const requested = resolve(clientDir, `.${urlPath}`)
  // A plain startsWith(clientDir) also accepts siblings such as
  // `<clientDir>-secrets`. Require a real path boundary after the configured
  // client directory so encoded `../` segments cannot escape static assets.
  if (requested !== clientDir && !requested.startsWith(`${clientDir}${sep}`)) {
    res.statusCode = 403
    res.end()
    return
  }

  let target = requested
  if (!(await isFile(target))) target = join(clientDir, 'index.html')
  if (!(await isFile(target))) {
    res.statusCode = 404
    res.end('not found')
    return
  }

  const data = await readFile(target)
  res.statusCode = 200
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  if (target === join(clientDir, 'index.html')) {
    res.setHeader(
      'set-cookie',
      `${RUNTIME_COOKIE}=${runtimeToken}; HttpOnly; SameSite=Strict; Path=/`,
    )
    res.setHeader('cache-control', 'no-store')
  }
  res.setHeader('content-type', MIME_TYPES[extname(target)] ?? 'application/octet-stream')
  res.end(req.method === 'HEAD' ? undefined : data)
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag, fallback) => {
    const idx = args.indexOf(flag)
    return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : fallback
  }
  return {
    clientDir: resolve(get('--client', 'client')),
    registryPath: resolve(get('--registry', 'server/actions.mjs')),
    mainRegistryPath: resolve(get('--main-registry', 'server/main-actions.mjs')),
    routesPath: resolve(get('--routes', 'server/routes.mjs')),
    mainPath: resolve(get('--main', 'server/main.mjs')),
    port: Number(get('--port', '0')),
  }
}

server.listen(port, '127.0.0.1', () => {
  listeningPort = server.address().port
  process.stdout.write(`MURASAKI_PORT=${listeningPort}\n`)
})

let processShutdown
function shutdownProcess() {
  if (processShutdown) return processShutdown
  processShutdown = (async () => {
    await mainRuntime.shutdown({ reason: 'signal', force: true })
    updateEngine.dispose()
    await new Promise((resolveOk) => server.close(resolveOk))
    process.exit(0)
  })()
  return processShutdown
}
process.on('SIGINT', () => void shutdownProcess())
process.on('SIGTERM', () => void shutdownProcess())

// Safety net against orphaned servers on macOS/Linux: if the launcher (our
// parent) dies without running its shutdown handler — a force-quit or a
// crash — the OS reparents us to init (ppid 1). Detect that and exit so we
// don't linger as a stray process (which also shows up as an extra icon in
// the Dock). `.unref()` keeps this timer from holding the event loop open on
// its own. Windows has no equivalent reparenting-to-init signal (a dead
// parent's pid just stays stale in our ppid), so this check is a no-op
// there — the Windows launcher instead assigns this process to a Job Object
// with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, which the OS itself enforces on
// launcher exit (see crates/native/src/launcher.rs's `win_job` module).
setInterval(() => {
  if (process.ppid === 1) process.exit(0)
}, 2000).unref()
