import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import http from 'node:http'
import net from 'node:net'
import { loadNative } from '../runtime/native.js'
import { detectLocale, resolveMenuLabels } from '../menu-i18n.js'
import type { MurasakiConfig } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * `murasaki dev` — run Vite dev server in a child process (its own event loop),
 * then attach a native WebView on the main thread. tao's event loop needs
 * the main thread on macOS, and Node's libuv can't share it — so the two
 * loops run in separate processes.
 */
export default async function dev(_argv: string[]) {
  const cwd = process.cwd()
  const config = await loadUserConfig(cwd)
  // The bundled `node` binary is otherwise the process's own name (visible in
  // the bold macOS app menu and the About panel) — prefer the product name.
  process.title = config.productName
  // murasaki pins Vite to an exact port (strictPort) so the parent knows the
  // URL to point the webview at. Probe first so a stale dev server (or anything
  // else) holding the default port steps us to the next free one instead of
  // hard-failing — the same auto-increment Vite does on its own, but with the
  // parent kept in the loop.
  const requestedPort = config.devPort ?? 5178
  const port = await findFreePort(requestedPort)
  if (port !== requestedPort) {
    process.stdout.write(`\n  Port ${requestedPort} is in use — starting on ${port} instead\n`)
  }
  const url = `http://localhost:${port}/`

  const vite = await startViteChild(cwd, port)
  try {
    await waitForServer(url, 15_000)
  } catch (err) {
    vite.kill()
    throw err
  }

  const native = await loadNative()
  const app = new native.Application()
  const webview = app.createWebview(
    {
      title: config.productName,
      width: config.window?.width ?? 1280,
      height: config.window?.height ?? 800,
      minWidth: config.window?.minWidth,
      minHeight: config.window?.minHeight,
      resizable: config.window?.resizable,
      transparent: config.window?.transparent,
      vibrancy: config.window?.vibrancy,
      icon: config.icon ? resolve(cwd, config.icon) : undefined,
      version: config.version,
      description: config.description,
      copyright: config.copyright,
      homepage: config.homepage,
      authors: config.authors,
      menuLabels: resolveMenuLabels(config.productName, detectLocale(), config.locales),
    },
    { url, devtools: true },
  )

  // Context menus are handled natively on the Rust side (see
  // crates/native/src/webview.rs) — Application::run() blocks Node's event
  // loop, so this callback never fires while the app is open anyway. Kept
  // for future use (e.g. once the run loop is wired to also pump libuv).
  webview.onIpcMessage(() => {})

  app.onQuit(() => {
    vite.kill()
    process.exit(0)
  })

  const cleanup = () => {
    vite.kill()
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('exit', cleanup)

  // Dock icon in dev mode too — see prod-launcher.mjs for why this needs to
  // be set at runtime rather than relying on Info.plist alone.
  if (config.icon) {
    try {
      app.setIconPath(resolve(cwd, config.icon))
    } catch {}
  }

  app.run()
}

// Vite's dev server binds `localhost`, which on macOS resolves to IPv6 `::1`.
// The probe below MUST bind the same host: a host-less `listen(port)` binds
// `0.0.0.0` (IPv4), which does NOT collide with a `[::1]:port` held by a stale
// dev server — so it would report the port free, hand it to Vite, and Vite
// would then fail to bind `::1`. Probing `localhost` matches Vite exactly.
const DEV_HOST = 'localhost'

/**
 * Resolves the first free TCP port at or after `startPort`, probing on the same
 * host Vite binds (`localhost`). Binds a throwaway server on each candidate and
 * returns the first that listens cleanly. There is an inherent probe→bind race
 * — Vite still runs with `strictPort`, so if the port is grabbed in that window
 * it fails loudly rather than silently drifting.
 */
function findFreePort(startPort: number, maxTries = 20): Promise<number> {
  return new Promise((resolveOk, rejectFail) => {
    let port = startPort
    let tries = 0
    const attempt = () => {
      const srv = net.createServer()
      srv.once('error', (err: NodeJS.ErrnoException) => {
        srv.close()
        if (err.code === 'EADDRINUSE' && tries++ < maxTries) {
          port++
          attempt()
        } else if (err.code === 'EADDRINUSE') {
          rejectFail(new Error(`no free port found in ${startPort}..${startPort + maxTries}`))
        } else {
          rejectFail(err)
        }
      })
      srv.once('listening', () => srv.close(() => resolveOk(port)))
      srv.listen(port, DEV_HOST)
    }
    attempt()
  })
}

function startViteChild(cwd: string, port: number) {
  // Runs Vite via its JS API in a child process (see assets/dev-server.mjs) so
  // murasaki can print its own branded banner instead of Vite's own CLI output —
  // the vite CLI itself is never invoked here.
  const devServerEntry = resolve(__dirname, '../../assets/dev-server.mjs')
  const child = spawn(process.execPath, [devServerEntry, '--port', String(port)], {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  })
  child.on('exit', (code) => {
    // The child (assets/dev-server.mjs) already prints a branded error on a
    // fatal exit — just mirror its code without adding a second, rawer line.
    if (code && code !== 0) process.exit(code)
  })
  return child
}

/**
 * Poll the actual dev URL until it answers. Uses http.get on the same URL the
 * webview loads — Node resolves `localhost` across IPv4/IPv6, so this waits for
 * exactly the endpoint that matters (Vite binds to `::1` on macOS, which a raw
 * `127.0.0.1` TCP probe would miss forever).
 */
function waitForServer(url: string, timeoutMs: number): Promise<void> {
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
          return rejectFail(new Error(`vite did not serve ${url} in time`))
        setTimeout(tryOnce, 100)
      })
    }
    tryOnce()
  })
}

async function loadUserConfig(cwd: string): Promise<MurasakiConfig> {
  for (const name of ['murasaki.config.ts', 'murasaki.config.js', 'murasaki.config.mjs']) {
    const p = resolve(cwd, name)
    try {
      const mod = await import(pathToFileURL(p).href)
      const cfg = mod.default ?? mod.config ?? mod
      if (cfg && typeof cfg === 'object') return cfg
    } catch (err: any) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err
    }
  }
  throw new Error(
    'murasaki: no config found — create murasaki.config.ts at the project root.',
  )
}
