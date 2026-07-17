import { mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  MainContext,
  MainDefinition,
  OpenRequestEvent,
  QuitContext,
  QuitReason,
  SecondInstanceEvent,
} from '../main/index.js'
import { createMainLogger } from '../main/logger.js'
import { createSidecarSupervisor } from '../main/sidecar.js'
import { createCrashDiagnostics, writeCrashReportSync } from '../main/crash-reports.js'

const DEFAULT_MAIN_SHUTDOWN_TIMEOUT_MS = 10_000
const MAX_MAIN_SHUTDOWN_TIMEOUT_MS = 300_000

const DEFAULT_KEEP_CRASH_REPORTS = 20
const MIN_KEEP_CRASH_REPORTS = 1
const MAX_KEEP_CRASH_REPORTS = 100
const CRASH_REPORTS_SUBDIR = 'crash-reports'

function validateRuntimeShutdownTimeoutMs(value: number | undefined): void {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MAIN_SHUTDOWN_TIMEOUT_MS) {
    throw new TypeError(
      `shutdownTimeoutMs must be a positive safe integer no greater than ${MAX_MAIN_SHUTDOWN_TIMEOUT_MS}`,
    )
  }
}

/** Raw `diagnostics` config, passed through from `murasaki.config.ts` (dev) or resolved bundle metadata (prod). */
export interface MainRuntimeDiagnosticsOptions {
  /** Capture uncaught exceptions/rejections as local crash reports. Default true. */
  crashReports?: boolean
  /** Newest crash reports retained. Default 20, clamped 1-100. */
  keepReports?: number
}

export interface MainRuntimeOptions {
  appId: string
  productName: string
  version?: string
  /** murasaki's own version, for crash report `frameworkVersion`. Defaults to '0.0.0'. */
  frameworkVersion?: string
  projectRoot: string
  resourcesPath?: string
  isPackaged: boolean
  shutdownTimeoutMs?: number
  /** Internal/test override; normal apps use platform-standard locations. */
  paths?: MainContext['paths']
  diagnostics?: MainRuntimeDiagnosticsOptions
}

export interface ShutdownOptions {
  reason: QuitReason
  force?: boolean
}

export interface ShutdownResult {
  cancelled: boolean
  timedOut: boolean
}

type RuntimeState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

type WindowControlPhase = 'starting' | 'running' | 'stopping'

function setMainWindowControlPhase(phase: WindowControlPhase): void {
  const phaseKey = Symbol.for('murasaki.main.window-control.phase.v1')
  const busKey = Symbol.for('murasaki.main.window-control.v1')
  const root = globalThis as typeof globalThis & { [key: symbol]: unknown }
  root[phaseKey] = phase
  const bus = root[busKey] as {
    phase: WindowControlPhase
    commands: unknown[]
    pending: Map<string, {
      timer: ReturnType<typeof setTimeout>
      reject(error: Error): void
    }>
  } | undefined
  if (!bus) return
  bus.phase = phase
  if (phase !== 'stopping') return
  for (const pending of bus.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error('native window control stopped'))
  }
  bus.pending.clear()
  bus.commands.length = 0
}

type DeadlineResult<T> =
  | { completed: true; value: T }
  | { completed: false }

async function runBeforeDeadline<T>(
  deadline: number,
  operation: () => T | PromiseLike<T>,
): Promise<DeadlineResult<T>> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) return { completed: false }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<DeadlineResult<T>>((resolveOk) => {
    // This deadline is part of the awaited lifecycle contract. Keeping it
    // referenced guarantees shutdown settles even when no server/socket handle
    // remains to keep Node alive (notably isolated runtimes and startup exits).
    timer = setTimeout(() => resolveOk({ completed: false }), remainingMs)
  })
  try {
    return await Promise.race([
      Promise.resolve().then(operation).then((value) => ({ completed: true, value }) as const),
      timeout,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class MainRuntime {
  #state: RuntimeState = 'idle'
  #definition: MainDefinition | null = null
  #context: MainContext | null = null
  #abortController = new AbortController()
  #startPromise: Promise<MainContext> | null = null
  #shutdownPromise: Promise<ShutdownResult> | null = null
  #forceShutdownSignal: Promise<void> | null = null
  #resolveForceShutdown: (() => void) | null = null
  #forceShutdownReason: QuitReason | null = null
  #openRequestQueue: Promise<void> = Promise.resolve()
  #queuedOpenRequests = 0

  constructor(private readonly options: MainRuntimeOptions) {}

  get state(): RuntimeState {
    return this.#state
  }

  get context(): MainContext | null {
    return this.#context
  }

  start(load: () => Promise<unknown>): Promise<MainContext> {
    if (this.#startPromise) return this.#startPromise
    if (this.#state !== 'idle') {
      return Promise.reject(new Error(`main runtime cannot start from ${this.#state}`))
    }

    this.#state = 'starting'
    setMainWindowControlPhase('starting')
    this.#startPromise = (async () => {
      try {
        const context = await createMainContext(this.options, this.#abortController.signal)
        const loaded = await load()
        const candidate = unwrapMainDefinition(loaded)
        this.#definition = candidate
        this.#context = context
        context.log.info('main runtime starting', { packaged: context.isPackaged })
        await candidate.ready?.(context)
        // A bounded shutdown may have timed out while ready() ignored its
        // AbortSignal. A late resolution must not resurrect a runtime the host
        // has already committed to stopping.
        if (this.#state === 'starting') {
          this.#state = 'running'
          setMainWindowControlPhase('running')
          context.log.info('main runtime ready')
          // `start()` is the durability boundary for lifecycle diagnostics;
          // callers may immediately tear down an isolated/test runtime.
          await context.log.flush()
        }
        return context
      } catch (error) {
        if (this.#context) {
          this.#context.log.error('main runtime startup failed', { error })
          await this.#context.log.flush()
        }
        if (this.#state !== 'stopped') this.#state = 'failed'
        setMainWindowControlPhase('stopping')
        this.#abortController.abort(error)
        throw error
      }
    })()
    return this.#startPromise
  }

  shutdown(options: ShutdownOptions): Promise<ShutdownResult> {
    if (this.#shutdownPromise) {
      if (options.force) {
        this.#forceShutdownReason = options.reason
        this.#abortController.abort(options.reason)
        this.#resolveForceShutdown?.()
      }
      return this.#shutdownPromise
    }
    this.#forceShutdownReason = options.force ? options.reason : null
    this.#forceShutdownSignal = new Promise((resolveOk) => {
      this.#resolveForceShutdown = resolveOk
    })
    if (options.force) {
      // A forced quit may arrive while ready() is still pending. Abort its
      // background work immediately; #shutdown still applies the same total
      // deadline if the hook ignores the signal.
      this.#abortController.abort(options.reason)
    }
    this.#shutdownPromise = this.#shutdown(options)
    return this.#shutdownPromise
  }

  async secondInstance(event: SecondInstanceEvent): Promise<void> {
    await this.#startPromise
    if (this.#state !== 'running' || !this.#definition || !this.#context) {
      throw new Error(`main runtime cannot receive a second instance from ${this.#state}`)
    }
    await this.#definition.secondInstance?.(this.#context, event)
  }

  openRequested(event: OpenRequestEvent): Promise<void> {
    if (this.#queuedOpenRequests >= 32) {
      throw new Error('main runtime open request queue is full')
    }
    this.#queuedOpenRequests++
    const run = async () => {
      await this.#startPromise
      if (this.#state !== 'running' || !this.#definition || !this.#context) {
        throw new Error(`main runtime cannot receive an open request from ${this.#state}`)
      }
      await this.#definition.openRequested?.(this.#context, event)
    }
    const result = this.#openRequestQueue.then(run)
    this.#openRequestQueue = result.catch(() => {}).finally(() => {
      this.#queuedOpenRequests--
    })
    return result
  }

  #resetCancelledShutdown(): void {
    this.#state = 'running'
    setMainWindowControlPhase('running')
    this.#shutdownPromise = null
    this.#forceShutdownSignal = null
    this.#resolveForceShutdown = null
    this.#forceShutdownReason = null
  }

  async #shutdown(options: ShutdownOptions): Promise<ShutdownResult> {
    if (this.#state === 'idle' || this.#state === 'stopped') {
      this.#state = 'stopped'
      setMainWindowControlPhase('stopping')
      return { cancelled: false, timedOut: false }
    }

    validateRuntimeShutdownTimeoutMs(this.options.shutdownTimeoutMs)
    const timeoutMs = this.options.shutdownTimeoutMs ?? DEFAULT_MAIN_SHUTDOWN_TIMEOUT_MS
    // The budget starts when shutdown is requested, even if ready() is still
    // running. Otherwise a pending startup plus beforeQuit/shutdown could make
    // the native transport wait for multiple full timeout windows.
    const deadline = Date.now() + timeoutMs

    try {
      const start = await runBeforeDeadline(deadline, () => this.#startPromise)
      if (!start.completed) {
        this.#abortController.abort(options.reason)
        this.#state = 'stopped'
        setMainWindowControlPhase('stopping')
        return { cancelled: false, timedOut: true }
      }
    } catch {
      // Startup already failed and aborted the context. Quitting should fail
      // open so a broken ready() hook cannot keep the native host alive.
      this.#state = 'stopped'
      return { cancelled: false, timedOut: false }
    }

    const definition = this.#definition
    const context = this.#context
    if (!definition || !context) {
      this.#state = 'stopped'
      setMainWindowControlPhase('stopping')
      return { cancelled: false, timedOut: false }
    }

    this.#state = 'stopping'
    let quitContext: QuitContext = { ...context, reason: options.reason }
    let shutdownCommitted = options.force === true
    try {
      // One end-to-end budget covers both beforeQuit and shutdown. The native
      // transport waits for this budget plus a small response grace period, so
      // a slow beforeQuit hook cannot consume cleanup time and then leave the
      // native host blocked for a second full timeout.
      if (!options.force) {
        const beforeQuit = await Promise.race([
          runBeforeDeadline(deadline, () => definition.beforeQuit?.(quitContext))
            .then(
              (outcome) => ({ kind: 'hook' as const, outcome }),
              (error: unknown) => ({ kind: 'error' as const, error }),
            ),
          (this.#forceShutdownSignal ?? new Promise<void>(() => {}))
            .then(() => ({ kind: 'force' as const })),
        ])
        if (beforeQuit.kind === 'force'
          || (beforeQuit.kind === 'error' && this.#forceShutdownReason !== null)) {
          shutdownCommitted = true
          quitContext = {
            ...context,
            reason: this.#forceShutdownReason ?? options.reason,
          }
        } else if (beforeQuit.kind === 'error') {
          throw beforeQuit.error
        } else if (!beforeQuit.outcome.completed) {
          shutdownCommitted = true
          setMainWindowControlPhase('stopping')
          this.#abortController.abort(options.reason)
          this.#state = 'stopped'
          return { cancelled: false, timedOut: true }
        } else if (beforeQuit.outcome.value === false) {
          this.#resetCancelledShutdown()
          return { cancelled: true, timedOut: false }
        }
      }

      shutdownCommitted = true
      setMainWindowControlPhase('stopping')
      this.#abortController.abort(quitContext.reason)
      context.log.info('main runtime shutting down', { reason: quitContext.reason })
      const cleanup = await runBeforeDeadline(deadline, async () => {
        await definition.shutdown?.(quitContext)
        await context.sidecars.stopAll()
        await context.log.flush()
      })
      this.#state = 'stopped'
      return { cancelled: false, timedOut: !cleanup.completed }
    } catch (error) {
      if (!shutdownCommitted) {
        // beforeQuit runs before the irreversible abort/cleanup boundary.
        // Treat a thrown/rejected veto like a cancelled quit. Record the
        // failure, but keep Main and dev HMR live for a retry.
        context.log.error('beforeQuit failed; shutdown cancelled', { error })
        this.#resetCancelledShutdown()
        return { cancelled: true, timedOut: false }
      }
      // Failure after shutdown commits must fail the transport open so the
      // native host can exit, without pinning a rejected single-flight.
      this.#abortController.abort(quitContext.reason)
      this.#state = 'stopped'
      this.#shutdownPromise = null
      this.#forceShutdownSignal = null
      this.#resolveForceShutdown = null
      this.#forceShutdownReason = null
      throw error
    }
  }
}

export function unwrapMainDefinition(loaded: unknown): MainDefinition {
  const namespace = loaded as { default?: unknown } | null
  const candidate = namespace && typeof namespace === 'object' && 'default' in namespace
    ? namespace.default
    : loaded
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError('src/main.ts must default-export defineMain({ ... })')
  }
  for (const hook of ['ready', 'secondInstance', 'openRequested', 'beforeQuit', 'shutdown'] as const) {
    const value = (candidate as MainDefinition)[hook]
    if (value !== undefined && typeof value !== 'function') {
      throw new TypeError(`main lifecycle hook ${hook} must be a function`)
    }
  }
  return candidate as MainDefinition
}

async function createMainContext(
  options: MainRuntimeOptions,
  signal: AbortSignal,
): Promise<MainContext> {
  const paths = options.paths ?? resolveAppPaths(options.appId)
  const version = options.version ?? '0.0.0'
  const frameworkVersion = options.frameworkVersion ?? '0.0.0'
  const crashReportsDir = join(paths.data, CRASH_REPORTS_SUBDIR)
  const diagnosticsSettings = resolveDiagnosticsOptions(options.diagnostics)
  if (diagnosticsSettings.crashReports) {
    installNodeCrashReportHooks({
      directory: crashReportsDir,
      appVersion: version,
      frameworkVersion,
      keepReports: diagnosticsSettings.keepReports,
    })
  }
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })))
  const log = createMainLogger({
    directory: paths.logs,
    appId: options.appId,
    productName: options.productName,
    version,
    console: false,
  })
  const resourcesPath = resolve(options.resourcesPath ?? options.projectRoot)
  const sidecars = await createSidecarSupervisor({
    resourcesPath,
    paths,
    signal,
    log,
  })
  return {
    appId: options.appId,
    productName: options.productName,
    version,
    isPackaged: options.isPackaged,
    platform: process.platform,
    arch: process.arch,
    projectRoot: resolve(options.projectRoot),
    resourcesPath,
    paths,
    log,
    diagnostics: createCrashDiagnostics(crashReportsDir),
    sidecars,
    signal,
  }
}

function resolveDiagnosticsOptions(
  diagnostics: MainRuntimeDiagnosticsOptions | undefined,
): { crashReports: boolean; keepReports: number } {
  const keepReports = diagnostics?.keepReports === undefined
    ? DEFAULT_KEEP_CRASH_REPORTS
    : Math.min(MAX_KEEP_CRASH_REPORTS, Math.max(MIN_KEEP_CRASH_REPORTS, diagnostics.keepReports))
  return { crashReports: diagnostics?.crashReports ?? true, keepReports }
}

interface CrashHookOptions {
  directory: string
  appVersion: string
  frameworkVersion: string
  keepReports: number
}

// A dev HMR reload calls createMainContext() repeatedly in the same process
// (see vite-plugin/main-process.ts). Guard installation with a global symbol
// (the same pattern as the window-control/event buses above) so a reload
// never stacks a second uncaughtException/unhandledRejection listener.
const CRASH_HOOKS_INSTALLED = Symbol.for('murasaki.main.crash-hooks.v1')

function installNodeCrashReportHooks(options: CrashHookOptions): void {
  const root = globalThis as typeof globalThis & { [key: symbol]: unknown }
  if (root[CRASH_HOOKS_INSTALLED]) return
  root[CRASH_HOOKS_INSTALLED] = true

  const handleFatal = (error: unknown): void => {
    const { message, stack } = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error), stack: undefined }
    // Synchronous and atomic (temp file + rename) so this completes before
    // the process exits below — never queued behind the logger's async
    // append. Best-effort: a failed write must not stop the process from
    // crashing normally.
    writeCrashReportSync(options.directory, {
      domain: 'node',
      message,
      stack,
      appVersion: options.appVersion,
      frameworkVersion: options.frameworkVersion,
    }, options.keepReports)
    // Registering these listeners replaces Node's own default fail-fast
    // behavior (print the exception, exit non-zero). Reproduce it: this hook
    // only adds a report write in front of the same crash, never swallows it.
    console.error(error)
    process.exit(1)
  }

  process.on('uncaughtException', handleFatal)
  process.on('unhandledRejection', handleFatal)
}

export function resolveAppPaths(appId: string): MainContext['paths'] {
  const safeId = appId.replace(/[^A-Za-z0-9._-]/g, '_') || 'murasaki-app'
  if (process.platform === 'darwin') {
    return {
      data: join(homedir(), 'Library', 'Application Support', safeId),
      cache: join(homedir(), 'Library', 'Caches', safeId),
      logs: join(homedir(), 'Library', 'Logs', safeId),
      temp: join(tmpdir(), safeId),
    }
  }
  if (process.platform === 'win32') {
    const dataRoot = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    const cacheRoot = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return {
      data: join(dataRoot, safeId),
      cache: join(cacheRoot, safeId, 'Cache'),
      logs: join(cacheRoot, safeId, 'Logs'),
      temp: join(tmpdir(), safeId),
    }
  }
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  const cacheRoot = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
  return {
    data: join(dataRoot, safeId),
    cache: join(cacheRoot, safeId),
    logs: join(stateRoot, safeId, 'logs'),
    temp: join(tmpdir(), safeId),
  }
}
