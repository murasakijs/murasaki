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

export interface MainRuntimeOptions {
  appId: string
  productName: string
  version?: string
  projectRoot: string
  resourcesPath?: string
  isPackaged: boolean
  shutdownTimeoutMs?: number
  /** Internal/test override; normal apps use platform-standard locations. */
  paths?: MainContext['paths']
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

export class MainRuntime {
  #state: RuntimeState = 'idle'
  #definition: MainDefinition | null = null
  #context: MainContext | null = null
  #abortController = new AbortController()
  #startPromise: Promise<MainContext> | null = null
  #shutdownPromise: Promise<ShutdownResult> | null = null
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
    this.#startPromise = (async () => {
      try {
        const context = await createMainContext(this.options, this.#abortController.signal)
        const loaded = await load()
        const candidate = unwrapMainDefinition(loaded)
        this.#definition = candidate
        this.#context = context
        await candidate.ready?.(context)
        this.#state = 'running'
        return context
      } catch (error) {
        this.#state = 'failed'
        this.#abortController.abort(error)
        throw error
      }
    })()
    return this.#startPromise
  }

  shutdown(options: ShutdownOptions): Promise<ShutdownResult> {
    if (this.#shutdownPromise) return this.#shutdownPromise
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

  async #shutdown(options: ShutdownOptions): Promise<ShutdownResult> {
    if (this.#state === 'idle' || this.#state === 'stopped') {
      this.#state = 'stopped'
      return { cancelled: false, timedOut: false }
    }

    try {
      await this.#startPromise
    } catch {
      this.#state = 'stopped'
      return { cancelled: false, timedOut: false }
    }

    const definition = this.#definition
    const context = this.#context
    if (!definition || !context) {
      this.#state = 'stopped'
      return { cancelled: false, timedOut: false }
    }

    this.#state = 'stopping'
    const quitContext: QuitContext = { ...context, reason: options.reason }
    if (!options.force) {
      const decision = await definition.beforeQuit?.(quitContext)
      if (decision === false) {
        this.#state = 'running'
        this.#shutdownPromise = null
        return { cancelled: true, timedOut: false }
      }
    }

    this.#abortController.abort(options.reason)
    const timeoutMs = this.options.shutdownTimeoutMs ?? 10_000
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolveOk) => {
      timer = setTimeout(() => resolveOk('timeout'), timeoutMs)
      timer.unref?.()
    })
    const cleanup = Promise.resolve(definition.shutdown?.(quitContext)).then(() => 'done' as const)
    const outcome = await Promise.race([cleanup, timeout])
    if (timer) clearTimeout(timer)
    this.#state = 'stopped'
    return { cancelled: false, timedOut: outcome === 'timeout' }
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
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })))
  return {
    appId: options.appId,
    productName: options.productName,
    version: options.version ?? '0.0.0',
    isPackaged: options.isPackaged,
    platform: process.platform,
    arch: process.arch,
    projectRoot: resolve(options.projectRoot),
    resourcesPath: resolve(options.resourcesPath ?? options.projectRoot),
    paths,
    signal,
  }
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
