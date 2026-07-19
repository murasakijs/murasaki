import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { validateMainShutdownTimeoutMs, type MurasakiConfig } from '../config.js'
import { MainRuntime } from '../runtime/main-runtime.js'
import { consumeDevLaunchArgv, type LaunchSnapshot } from '../runtime/launch.js'
import { isAuthorizedNativeRequest, runtimeToken } from './runtime-security.js'
import { murasakiVersion } from '../cli/brand.js'
import type { MainWindowLifecycleEvent } from '../main/index.js'

interface Options {
  config: MurasakiConfig
}

const MAIN_WINDOW_COMMANDS_PATH = '/__murasaki/main/windows/commands'
const MAIN_WINDOW_RESULT_PATH = '/__murasaki/main/windows/result'
const MAIN_WINDOW_EVENT_PATH = '/__murasaki/main/windows/event'
const MAIN_WINDOW_CONTROL_BUS = Symbol.for('murasaki.main.window-control.v1')

interface MainWindowControlBus {
  commands: Array<{ id: string; method: string; label?: string }>
  pending: Map<string, {
    resolve(value: unknown): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  }>
  listeners: Set<(event: MainWindowLifecycleEvent) => void>
}

function mainWindowControlBus(): MainWindowControlBus | undefined {
  const root = globalThis as typeof globalThis & { [key: symbol]: unknown }
  return root[MAIN_WINDOW_CONTROL_BUS] as MainWindowControlBus | undefined
}

function takeMainWindowControlCommands(): MainWindowControlBus['commands'] {
  const bus = mainWindowControlBus()
  const commands: MainWindowControlBus['commands'] = []
  while (commands.length < 32 && (bus?.commands.length ?? 0) > 0) {
    const command = bus!.commands.shift()!
    if (bus!.pending.has(command.id)) commands.push(command)
  }
  return commands
}

function settleMainWindowControlCommand(
  id: string,
  result: { ok: true; value: unknown } | { ok: false; error: string },
): void {
  const bus = mainWindowControlBus()
  const pending = bus?.pending.get(id)
  if (!pending || !bus) return
  bus.pending.delete(id)
  clearTimeout(pending.timer)
  if (result.ok) pending.resolve(result.value)
  else pending.reject(new Error(result.error))
}

function emitMainWindowLifecycle(event: MainWindowLifecycleEvent): void {
  const bus = mainWindowControlBus()
  if (!bus) return
  for (const listener of bus.listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('murasaki: window lifecycle listener failed:', error)
    }
  }
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
      // Consume the dev launch transport exactly once, here, before any runtime
      // (and thus any app-owned sidecar) can spawn — deleting the env var so
      // sidecars never inherit it. The frozen snapshot is shared by the initial
      // runtime and every HMR-created replacement, so a reload can never observe
      // a different launch than cold start.
      const launch: LaunchSnapshot = Object.freeze({
        argv: Object.freeze(consumeDevLaunchArgv()),
        cwd: projectRoot,
      })
      const entry = config.main === false
        ? null
        : resolve(projectRoot, config.main?.entry ?? 'src/main.ts')
      let runtime = entry && existsSync(entry) ? createRuntime(config, projectRoot, launch) : undefined
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
        const isWindowControl = pathname === MAIN_WINDOW_COMMANDS_PATH
          || pathname === MAIN_WINDOW_RESULT_PATH
          || pathname === MAIN_WINDOW_EVENT_PATH
        if (pathname !== '/__murasaki/main/shutdown' && !isWindowControl) return next()
        const validMethod = pathname === MAIN_WINDOW_COMMANDS_PATH
          ? req.method === 'GET'
          : req.method === 'POST'
        if (!validMethod || !isAuthorizedNativeRequest(req, token)) {
          res.statusCode = 403
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ error: 'forbidden native request' }))
          return
        }

        if (pathname === MAIN_WINDOW_COMMANDS_PATH) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(takeMainWindowControlCommands()))
          return
        }

        if (pathname === MAIN_WINDOW_RESULT_PATH) {
          void readJsonRequest(req).then((body) => {
            if (!isWindowResult(body)) throw new Error('invalid native window result')
            settleMainWindowControlCommand(
              body.id,
              body.ok
                ? { ok: true, value: body.value }
                : { ok: false, error: body.error },
            )
            res.statusCode = 204
            res.setHeader('cache-control', 'no-store')
            res.end()
          }).catch((error) => sendControlError(res, error))
          return
        }

        if (pathname === MAIN_WINDOW_EVENT_PATH) {
          void readJsonRequest(req).then((body) => {
            if (!isWindowLifecycleEvent(body)) throw new Error('invalid native window lifecycle event')
            emitMainWindowLifecycle(body)
            res.statusCode = 204
            res.setHeader('cache-control', 'no-store')
            res.end()
          }).catch((error) => sendControlError(res, error))
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
            runtime = createRuntime(config, projectRoot, launch)
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

function sendControlError(res: import('node:http').ServerResponse, error: unknown): void {
  res.statusCode = 400
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid native window request' }))
}

function isWindowResult(value: unknown): value is
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; error: string } {
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  return typeof body.id === 'string' && body.id.length <= 64
    && typeof body.ok === 'boolean'
    && (body.ok || (typeof body.error === 'string' && body.error.length <= 4096))
}

/** @internal Validates lifecycle data received from the native-only endpoint. */
export function isWindowLifecycleEvent(value: unknown): value is MainWindowLifecycleEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (!['created', 'shown', 'hidden', 'focused', 'blurred', 'closed'].includes(String(event.type))
    || typeof event.label !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(event.label)
    || !Number.isSafeInteger(event.generation)
    || (event.generation as number) < 1
    || typeof event.primary !== 'boolean') return false
  if (event.type === 'closed') return event.state === null
  if (event.state === null) return false
  if (!event.state || typeof event.state !== 'object') return false
  const state = event.state as Record<string, unknown>
  return state.label === event.label
    && state.generation === event.generation
    && state.primary === event.primary
    && ['visible', 'focused', 'minimized', 'maximized']
      .every((field) => typeof state[field] === 'boolean')
}

function readJsonRequest(req: import('node:http').IncomingMessage): Promise<unknown> {
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
        rejectFail(new Error('native window request is too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (rejected) return
      try {
        resolveOk(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        rejectFail(error)
      }
    })
    req.on('error', rejectFail)
  })
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

function createRuntime(config: MurasakiConfig, projectRoot: string, launch: LaunchSnapshot): MainRuntime {
  const shutdownTimeoutMs = config.main === false ? undefined : config.main?.shutdownTimeoutMs
  validateMainShutdownTimeoutMs(shutdownTimeoutMs)
  return new MainRuntime({
    appId: config.appId,
    productName: config.productName,
    version: config.version,
    frameworkVersion: murasakiVersion(),
    projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    shutdownTimeoutMs,
    diagnostics: config.diagnostics,
    launch,
  })
}
