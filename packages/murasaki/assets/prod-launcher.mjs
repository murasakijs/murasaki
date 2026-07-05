#!/usr/bin/env node
// murasaki production launcher — spawns prod-server.mjs (a small Node HTTP
// server that serves the built client and runs 'use server' actions out of
// the dist/server registry, see that file) as a child process, then points
// the native WebView at it over http://127.0.0.1:<port>/. This mirrors
// `murasaki dev` (src/cli/dev.ts spawns Vite the same way) closely enough
// that the client's `/__murasaki/action/…` fetch works unchanged in both —
// the murasaki:// custom protocol (crates/native) is no longer used here.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const meta = JSON.parse(await readFile(join(__dirname, 'murasaki-meta.json'), 'utf8'))

const server = spawn(
  process.execPath,
  [
    join(__dirname, 'prod-server.mjs'),
    '--client', join(__dirname, 'client'),
    '--registry', join(__dirname, 'server/actions.mjs'),
    '--routes', join(__dirname, 'server/routes.mjs'),
    '--port', '0',
  ],
  { cwd: __dirname, stdio: ['ignore', 'pipe', 'inherit'] },
)

const shutdown = () => {
  server.kill()
}

let port
try {
  port = await waitForPort(server, 15_000)
} catch (err) {
  shutdown()
  throw err
}

const url = `http://127.0.0.1:${port}/`
try {
  await waitForServer(url, 15_000)
} catch (err) {
  shutdown()
  throw err
}

const native = require('@murasakijs/native')
const app = new native.Application()
const webview = app.createWebview(
  {
    title: meta.productName,
    width: meta.width ?? 1000,
    height: meta.height ?? 700,
    vibrancy: meta.vibrancy ?? null,
    icon: meta.icon ? join(__dirname, meta.icon) : undefined,
  },
  { url, devtools: false },
)
webview.onIpcMessage(() => {})
app.onQuit(() => {
  shutdown()
  process.exit(0)
})
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', shutdown)

// Dock/About-panel icon. Info.plist's CFBundleIconFile covers the .app's
// Finder/DMG appearance, but this process is the bundled `node` binary
// (not a "real" app executable) — set NSApp.applicationIconImage explicitly
// so the running app also shows the icon.
if (meta.icon) {
  try {
    app.setIconPath(join(__dirname, meta.icon))
  } catch {}
}

app.run()

/**
 * prod-server.mjs is started with `--port 0` (OS-assigned) since the
 * launcher doesn't know a free port ahead of time — it reports the port it
 * actually bound by printing `MURASAKI_PORT=<n>` to stdout once listening
 * (see that file). Buffers stdout until that line shows up, then resumes
 * forwarding the child's output straight through.
 */
function waitForPort(child, timeoutMs) {
  return new Promise((resolveOk, rejectFail) => {
    let buf = ''
    let settled = false
    const onData = (chunk) => {
      buf += chunk.toString()
      const m = buf.match(/MURASAKI_PORT=(\d+)/)
      if (m && !settled) {
        settled = true
        child.stdout.off('data', onData)
        child.stdout.pipe(process.stdout)
        resolveOk(Number(m[1]))
      }
    }
    child.stdout.on('data', onData)
    child.once('exit', (code) => {
      if (!settled) rejectFail(new Error(`prod server exited with code ${code}`))
    })
    setTimeout(() => {
      if (!settled) rejectFail(new Error('prod server did not report a port in time'))
    }, timeoutMs)
  })
}

/**
 * Same readiness probe as murasaki dev (src/cli/dev.ts's waitForServer) —
 * poll the exact URL the webview will load until it answers.
 */
function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolveOk, rejectFail) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolveOk()
      })
      req.setTimeout(1000, () => req.destroy(new Error('probe timeout')))
      req.once('error', () => {
        if (Date.now() >= deadline)
          return rejectFail(new Error(`prod server did not serve ${url} in time`))
        setTimeout(tryOnce, 100)
      })
    }
    tryOnce()
  })
}
