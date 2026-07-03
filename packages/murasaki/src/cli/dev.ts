import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import http from 'node:http'
import { loadNative } from '../runtime/native.js'
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
  const port = config.devPort ?? 5178
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
    if (code && code !== 0) {
      process.stderr.write(`\n  vite exited with code ${code}\n`)
      process.exit(code)
    }
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
