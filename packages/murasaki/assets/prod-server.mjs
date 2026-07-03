#!/usr/bin/env node
// murasaki production server — serves the built client (dist/client) and
// runs 'use server' actions out of the registry built by cli/build-server.ts
// (dist/server/actions.mjs). This is the prod counterpart of Vite's dev
// server + the dev middleware in src/vite-plugin/server-actions.ts: the
// client's `fetch('/__murasaki/action/<id>/<name>')` stub is identical in
// both, so this process only needs to answer the same two shapes Vite's dev
// middleware does (static files, and POST /__murasaki/action/…).
//
// Run standalone for testing (`node prod-server.mjs --client <dir> --registry
// <path> --port <n>`) or spawned by assets/prod-launcher.mjs, which reads the
// assigned port off a `MURASAKI_PORT=<n>` line printed to stdout once the
// server is listening (see prod-launcher.mjs's waitForPort).
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ACTION_PATH_PREFIX = '/__murasaki/action/'

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

const { clientDir, registryPath, port } = parseArgs()

let registryPromise
function loadRegistry() {
  if (!registryPromise) {
    registryPromise = import(pathToFileURL(registryPath).href).then((m) => m.registry ?? {})
  }
  return registryPromise
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
    port: Number(get('--port', '0')),
  }
}

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`MURASAKI_PORT=${server.address().port}\n`)
})

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
