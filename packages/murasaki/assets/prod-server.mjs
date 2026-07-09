#!/usr/bin/env node
// murasaki production server — serves the built client (dist/client), runs
// 'use server' actions out of the registry built by cli/build-server.ts
// (dist/server/actions.mjs), and dispatches `src/api/**/route.ts` handlers
// out of the parallel routes registry (dist/server/routes.mjs). This is the
// prod counterpart of Vite's dev server + the dev middlewares in
// src/vite-plugin/server-actions.ts and src/vite-plugin/api-routes.ts: the
// client's `fetch('/__murasaki/action/<id>/<name>')` stub and `/api/*`
// requests are identical in both, so this process only needs to answer the
// same shapes Vite's dev middlewares do (static files, POST
// /__murasaki/action/…, and /api/…).
//
// Run standalone for testing (`node prod-server.mjs --client <dir> --registry
// <path> --routes <path> --port <n>`) or spawned by assets/prod-launcher.mjs,
// which reads the assigned port off a `MURASAKI_PORT=<n>` line printed to
// stdout once the server is listening (see prod-launcher.mjs's waitForPort).
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ACTION_PATH_PREFIX = '/__murasaki/action/'
const API_PATH_PREFIX = '/api/'

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

const { clientDir, registryPath, routesPath, port } = parseArgs()

let registryPromise
function loadRegistry() {
  if (!registryPromise) {
    registryPromise = import(pathToFileURL(registryPath).href).then((m) => m.registry ?? {})
  }
  return registryPromise
}

let routesPromise
function loadRoutes() {
  if (!routesPromise) {
    routesPromise = import(pathToFileURL(routesPath).href).then((m) => m.routes ?? [])
  }
  return routesPromise
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    if (!res.headersSent) res.statusCode = 500
    res.end(`internal error: ${err?.message ?? err}`)
  })
})

async function handleRequest(req, res) {
  if (req.method === 'POST' && req.url?.startsWith(ACTION_PATH_PREFIX)) {
    return handleAction(req, res)
  }
  const pathname = (req.url ?? '/').split('?')[0]
  if (pathname.startsWith(API_PATH_PREFIX)) {
    return handleApiRoute(req, res, pathname)
  }
  return serveStatic(req, res)
}

/** Mirrors the dev middleware's contract exactly (src/vite-plugin/server-actions.ts). */
async function handleAction(req, res) {
  const rest = req.url.slice(ACTION_PATH_PREFIX.length)
  const sepIndex = rest.lastIndexOf('/')
  if (sepIndex === -1) {
    res.statusCode = 404
    res.end()
    return
  }

  const encodedId = rest.slice(0, sepIndex)
  const name = rest.slice(sepIndex + 1)
  const actionId = decodeURIComponent(encodedId)

  let args
  try {
    const body = await readBody(req)
    const parsed = JSON.parse(body)
    if (!Array.isArray(parsed?.args)) throw new Error('missing "args" array')
    args = parsed.args
  } catch {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'invalid request body' }))
    return
  }

  try {
    const registry = await loadRegistry()
    const mod = registry[actionId]
    const fn = mod && mod[name]
    if (typeof fn !== 'function') {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: `no such server action: ${name}` }))
      return
    }

    const result = await fn(...args)
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(result))
  } catch (err) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: String(err?.message ?? err) }))
  }
}

function readBody(req) {
  return new Promise((resolveOk, rejectFail) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolveOk(data))
    req.on('error', rejectFail)
  })
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
    await sendWebResponse(res, response)
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
      params[name] = decodeURIComponent(match[i + 1] ?? '')
    })
    const totalSegments = route.pattern.split('/').filter(Boolean).length
    const score = totalSegments - route.paramNames.length
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
  const body = hasBody ? await readBodyBuffer(req) : undefined
  return new Request(url, { method, headers, body })
}

function readBodyBuffer(req) {
  return new Promise((resolveOk, rejectFail) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolveOk(Buffer.concat(chunks)))
    req.on('error', rejectFail)
  })
}

/** Web `Response` → Node `ServerResponse`. Mirrors vite-plugin/api-routes.ts's `sendWebResponse`. */
async function sendWebResponse(res, response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  if (!response.body) {
    res.end()
    return
  }
  const buf = Buffer.from(await response.arrayBuffer())
  res.end(buf)
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
  if (!requested.startsWith(clientDir)) {
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
    routesPath: resolve(get('--routes', 'server/routes.mjs')),
    port: Number(get('--port', '0')),
  }
}

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`MURASAKI_PORT=${server.address().port}\n`)
})

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

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
