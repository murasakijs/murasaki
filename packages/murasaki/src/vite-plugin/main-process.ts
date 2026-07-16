import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { validateMainShutdownTimeoutMs, type MurasakiConfig } from '../config.js'
import { MainRuntime } from '../runtime/main-runtime.js'
import { isAuthorizedNativeRequest, runtimeToken } from './runtime-security.js'

interface Options {
  config: MurasakiConfig
}

/** Starts and hot-reloads the first-class `src/main.ts` Node lifecycle in dev. */
export function mainProcessPlugin({ config }: Options): Plugin {
  let closeRuntime: (() => Promise<void>) | undefined
  return {
    name: 'murasaki:main-process',
    apply: 'serve',
    configureServer(server) {
      // Vite's configured root is authoritative. process.cwd() can be the
      // monorepo root while the app intentionally uses `root: 'apps/foo'`;
      // resolving src/main.ts against cwd would then start the wrong module
      // (or silently skip main entirely).
      const projectRoot = server.config.root
      const entry = config.main === false
        ? null
        : resolve(projectRoot, config.main?.entry ?? 'src/main.ts')
      let runtime = entry && existsSync(entry) ? createRuntime(config, projectRoot) : undefined
      let transition = Promise.resolve()
      let closing = false
      let terminalClosing = false
      const start = async () => {
        if (runtime && entry) await runtime.start(() => server.ssrLoadModule(entry))
      }
      const stop = async () => {
        await runtime?.shutdown({ reason: 'dev-reload', force: true })
      }
      closeRuntime = async () => {
        terminalClosing = true
        closing = true
        await stop()
      }

      const token = runtimeToken()
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '/').split('?')[0]
        if (pathname !== '/__murasaki/main/shutdown') return next()
        if (req.method !== 'POST' || !isAuthorizedNativeRequest(req, token)) {
          res.statusCode = 403
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ error: 'forbidden native request' }))
          return
        }

        void readShutdownRequest(req).then(async ({ reason, force }) => {
          // Do not wait behind an HMR stop/start transition. That can consume
          // one complete shutdown budget and then start a fresh runtime whose
          // shutdown consumes a second. Freeze reloads and shut down whichever
          // runtime is active now; MainRuntime coalesces/escalates any stop that
          // is already in flight.
          closing = true
          const result = runtime
            ? await runtime.shutdown({ reason, force })
            : { cancelled: false, timedOut: false }
          // A cancelled window close keeps the app and dev server alive. Let
          // later src/main.ts edits resume HMR unless the Vite server itself
          // started a terminal close while the hook was pending.
          if (result.cancelled) closing = terminalClosing
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(result))
        }).catch((error) => {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid shutdown request' }))
        })
      })

      if (!runtime || !entry) return

      server.watcher.on('change', (file) => {
        if (resolve(file) !== entry) return
        transition = transition
          .then(stop)
          .then(() => {
            if (closing) return
            const module = server.moduleGraph.getModuleById(entry)
            if (module) server.moduleGraph.invalidateModule(module)
            runtime = createRuntime(config, projectRoot)
            return start()
          })
          .catch((error) => {
            server.config.logger.error(`murasaki main reload failed: ${String(error)}`)
          })
      })

      server.httpServer?.once('close', () => {
        terminalClosing = true
        closing = true
        void stop().catch(() => {})
      })

      // Post-configure hook: Vite waits for this before accepting requests,
      // so the renderer never races main.ready().
      return async () => {
        await start()
      }
    },
    async closeBundle() {
      await closeRuntime?.()
    },
  }
}

function readShutdownRequest(
  req: import('node:http').IncomingMessage,
): Promise<{ reason: 'window-close' | 'app-quit'; force: boolean }> {
  const maxBytes = 16 * 1024
  return new Promise((resolveOk, rejectFail) => {
    let size = 0
    let rejected = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      if (rejected) return
      size += chunk.length
      if (size > maxBytes) {
        rejected = true
        rejectFail(new Error('shutdown request is too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (rejected) return
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        if ((body.reason !== 'window-close' && body.reason !== 'app-quit')
          || (body.force !== undefined && typeof body.force !== 'boolean')) {
          throw new Error('invalid shutdown request')
        }
        resolveOk({ reason: body.reason, force: body.force === true })
      } catch (error) {
        rejectFail(error)
      }
    })
    req.on('error', rejectFail)
  })
}

function createRuntime(config: MurasakiConfig, projectRoot: string): MainRuntime {
  const shutdownTimeoutMs = config.main === false ? undefined : config.main?.shutdownTimeoutMs
  validateMainShutdownTimeoutMs(shutdownTimeoutMs)
  return new MainRuntime({
    appId: config.appId,
    productName: config.productName,
    version: config.version,
    projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    shutdownTimeoutMs,
  })
}
