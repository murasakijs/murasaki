import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import net from 'node:net'
import { loadNative, type RuntimeWindowTemplate } from '../runtime/native.js'
import { detectLocale, resolveMenuLabels } from '../menu-i18n.js'
import { resolveWebviewNetworkConfig, type MurasakiConfig } from '../config.js'
import { loadUserConfig } from './load-config.js'
import { preparePlugins, runPluginHooks } from '../plugin-runtime.js'
import { serializeWindowTemplates } from './window-metadata.js'
import { resolveInitScripts } from './init-scripts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * `murasaki dev` — run Vite dev server in a child process (its own event loop),
 * then attach a native WebView on the main thread. tao's event loop needs
 * the main thread on macOS, and Node's libuv can't share it — so the two
 * loops run in separate processes.
 */
export default async function dev(_argv: string[]) {
  const cwd = process.cwd()
  const prepared = preparePlugins(await loadUserConfig(cwd, 'development'))
  const config = prepared.config
  const hookOptions = { projectRoot: cwd, command: 'dev' as const }
  await runPluginHooks(prepared, 'before', hookOptions)
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
  const url = `http://127.0.0.1:${port}/`

  const runtimeToken = randomBytes(32).toString('hex')
  const vite = await startViteChild(cwd, port, runtimeToken)
  try {
    await waitForServer(url, 15_000)
  } catch (err) {
    await stopViteChild(vite)
    throw err
  }

  try {
    const native = await loadNative()
    const app = new native.Application()
    const shutdownTimeoutMs = config.main === false
      ? 10_000
      : (config.main?.shutdownTimeoutMs ?? 10_000)
    if (app.configureShutdown) {
      app.configureShutdown(port, runtimeToken, shutdownTimeoutMs)
    } else {
      // Compatibility with an older native prebuild. Current prebuilds use
      // configureShutdown + run_return, so this callback is only a fallback.
      app.onQuit(() => vite.kill())
    }
    app.configureWindows(createDevWindowTemplates(config, cwd, url))

    // Do not install JavaScript SIGINT/SIGTERM listeners here. `app.run()` is
    // a blocking native event loop, so libuv cannot execute those callbacks;
    // registering them would suppress Node's default termination and make
    // Ctrl+C hang. Terminal Ctrl+C reaches the whole foreground process group
    // (the Vite child handles it too), while normal window/app shutdown returns
    // through the finally block below and performs a bounded child reap.
    process.on('exit', () => vite.kill())

    // Dock icon in dev mode too — see prod-launcher.mjs for why this needs to
    // be set at runtime rather than relying on Info.plist alone.
    if (config.icon) {
      try {
        app.setIconPath(resolve(cwd, config.icon))
      } catch {}
    }

    app.run()
  } finally {
    await stopViteChild(vite)
  }
  await runPluginHooks(prepared, 'after', hookOptions)
}

/** @internal Resolve the immutable catalog passed to the native dev host. */
export function createDevWindowTemplates(
  config: MurasakiConfig,
  cwd: string,
  url: string,
): RuntimeWindowTemplate[] {
  const webviewNetwork = resolveWebviewNetworkConfig(config)
  const initScripts = resolveInitScripts(config, cwd)
  return serializeWindowTemplates(config).map((declaration) => ({
    window: {
      label: declaration.label,
      primary: declaration.primary,
      title: declaration.title ?? config.productName,
      width: declaration.width ?? 1280,
      height: declaration.height ?? 800,
      minWidth: declaration.minWidth,
      minHeight: declaration.minHeight,
      maxWidth: declaration.maxWidth,
      maxHeight: declaration.maxHeight,
      resizable: declaration.resizable,
      transparent: declaration.transparent,
      visible: declaration.visible,
      decorations: declaration.decorations,
      titleBarStyle: declaration.titleBarStyle,
      fullscreen: declaration.fullscreen,
      // Coerce `null` (a valid WindowConfig.vibrancy value meaning "none") to
      // undefined: napi's Option<String> maps undefined to None but rejects an
      // explicit null with "Failed to convert Null into String".
      vibrancy: declaration.vibrancy ?? undefined,
      icon: config.icon ? resolve(cwd, config.icon) : undefined,
      version: config.version,
      description: config.description,
      copyright: config.copyright,
      homepage: config.homepage,
      authors: config.authors,
      menuLabels: resolveMenuLabels(config.productName, detectLocale(), config.locales),
    },
    webview: {
      url: new URL(declaration.route, url).href,
      devtools: true,
      appId: config.appId,
      ...webviewNetwork,
      initScripts,
      capabilities: declaration.capabilities,
      capabilityPolicy: declaration.capabilityPolicy,
      trayIcon: config.icon ? resolve(cwd, config.icon) : undefined,
    },
    createOnLaunch: declaration.createOnLaunch,
  }))
}

// Keep the port probe, Vite child, native shutdown client, and WebView on the
// same explicit loopback address. This avoids localhost choosing IPv6 while
// the Rust shutdown transport connects to IPv4.
const DEV_HOST = '127.0.0.1'

/**
 * Resolves the first free TCP port at or after `startPort`, probing on the same
 * host Vite binds (`127.0.0.1`). Binds a throwaway server on each candidate and
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

function startViteChild(cwd: string, port: number, runtimeToken: string) {
  // Runs Vite via its JS API in a child process (see assets/dev-server.mjs) so
  // murasaki can print its own branded banner instead of Vite's own CLI output —
  // the vite CLI itself is never invoked here.
  const devServerEntry = resolve(__dirname, '../../assets/dev-server.mjs')
  const child = spawn(process.execPath, [devServerEntry, '--port', String(port)], {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, MURASAKI_RUNTIME_TOKEN: runtimeToken },
  })
  child.on('exit', (code) => {
    // The child (assets/dev-server.mjs) already prints a branded error on a
    // fatal exit — just mirror its code without adding a second, rawer line.
    if (code && code !== 0) process.exit(code)
  })
  return child
}

async function stopViteChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolveOk) => child.once('exit', () => resolveOk()))
  child.kill('SIGTERM')
  let timer: ReturnType<typeof setTimeout> | undefined
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolveOk) => {
      timer = setTimeout(() => resolveOk(false), 3_000)
    }),
  ])
  if (timer) clearTimeout(timer)
  if (graceful || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await exited
}

/**
 * Poll the actual dev URL until it answers. The child binds the IPv4 loopback
 * explicitly so the Rust native host and the renderer use the same endpoint.
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
