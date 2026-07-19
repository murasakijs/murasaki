import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { MainLogger } from './logger.js'

const MAX_SIDECARS = 16
const MAX_ARGS = 128
const MAX_ARG_BYTES = 8 * 1024
const MAX_ENV_ENTRIES = 128
const MAX_ENV_VALUE_BYTES = 32 * 1024
const MAX_RESTARTS = 10
const MAX_STOP_TIMEOUT_MS = 30_000
const DEFAULT_STOP_TIMEOUT_MS = 5_000
/** Framework authority/build secrets that must never cross into app helpers. */
const RESERVED_SIDECAR_ENV_KEYS = new Set([
  'MURASAKI_RUNTIME_TOKEN',
  'MURASAKI_DEV_LAUNCH',
  'MURASAKI_UPDATE_KEY',
  'MURASAKI_WINDOWS_CERTIFICATE_PASSWORD',
  'APPLE_APP_PASSWORD',
])

export type SidecarWorkingDirectory = 'resources' | 'data' | 'cache' | 'temp'

export interface SidecarRestartPolicy {
  /** Restart only after an unexpected non-zero exit. Maximum 10. Default 0. */
  maxRestarts: number
  /** Delay before each restart. Range 0–60 seconds. Default 500 ms. */
  delayMs?: number
}

export interface SidecarSpawnOptions {
  /** Stable identifier, unique among live sidecars. */
  name: string
  /** Relative path to an executable bundled below `resourcesPath`. */
  resource: string
  /** Passed directly to the executable; Murasaki never invokes a shell. */
  args?: string[]
  /** A framework-owned working directory. Default `resources`. */
  cwd?: SidecarWorkingDirectory
  /** Additional environment variables. Inherits the Node Main environment. */
  env?: Record<string, string>
  restart?: SidecarRestartPolicy
}

export type SidecarEvent =
  | { type: 'started'; name: string; pid: number }
  | { type: 'stdout' | 'stderr'; name: string; data: string }
  | { type: 'exit'; name: string; code: number | null; signal: NodeJS.Signals | null; restarting: boolean }
  | { type: 'error'; name: string; message: string }

export interface SidecarHandle {
  readonly name: string
  readonly pid: number | null
  readonly running: boolean
  /** Settles after the final exit, including configured restarts. */
  readonly finished: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  onEvent(listener: (event: SidecarEvent) => void): () => void
  stop(timeoutMs?: number): Promise<void>
}

export interface SidecarSupervisor {
  spawn(options: SidecarSpawnOptions): Promise<SidecarHandle>
  list(): ReadonlyArray<{ name: string; pid: number | null; running: boolean }>
  stop(name: string, timeoutMs?: number): Promise<void>
  stopAll(timeoutMs?: number): Promise<void>
}

export interface SidecarSupervisorOptions {
  resourcesPath: string
  paths: {
    data: string
    cache: string
    temp: string
  }
  signal: AbortSignal
  log?: MainLogger
}

/**
 * Supervise executables explicitly bundled below the application resources
 * directory. Node Main is trusted code, but containment and bounded lifecycle
 * rules prevent accidental shell execution, traversal, and orphaned helpers.
 */
export async function createSidecarSupervisor(
  options: SidecarSupervisorOptions,
): Promise<SidecarSupervisor> {
  const resourcesRoot = await realpath(options.resourcesPath)
  const entries = new Map<string, SidecarController>()
  let stopping = options.signal.aborted

  const supervisor: SidecarSupervisor = {
    async spawn(spawnOptions) {
      if (stopping || options.signal.aborted) throw new Error('sidecar supervisor is stopping')
      validateSpawnOptions(spawnOptions)
      if (entries.size >= MAX_SIDECARS) {
        throw new Error(`sidecar supervisor allows at most ${MAX_SIDECARS} live entries`)
      }
      if (entries.has(spawnOptions.name)) {
        throw new Error(`sidecar ${spawnOptions.name} is already running`)
      }

      const executable = await resolveContainedExecutable(resourcesRoot, spawnOptions.resource)
      const cwd = selectWorkingDirectory(resourcesRoot, options.paths, spawnOptions.cwd)
      const controller = new SidecarController({
        options: spawnOptions,
        executable,
        cwd,
        log: options.log,
        onFinalExit: () => entries.delete(spawnOptions.name),
      })
      entries.set(spawnOptions.name, controller)
      try {
        controller.start()
      } catch (error) {
        entries.delete(spawnOptions.name)
        throw error
      }
      return controller.handle
    },
    list() {
      return [...entries.values()].map((entry) => ({
        name: entry.handle.name,
        pid: entry.handle.pid,
        running: entry.handle.running,
      }))
    },
    async stop(name, timeoutMs) {
      const entry = entries.get(name)
      if (!entry) return
      await entry.handle.stop(timeoutMs)
    },
    async stopAll(timeoutMs) {
      stopping = true
      await Promise.allSettled([...entries.values()].map((entry) => entry.handle.stop(timeoutMs)))
    },
  }

  options.signal.addEventListener('abort', () => {
    stopping = true
    void supervisor.stopAll().catch((error) => {
      options.log?.error('failed to stop sidecars after abort', { error })
    })
  }, { once: true })

  return supervisor
}

interface ControllerOptions {
  options: SidecarSpawnOptions
  executable: string
  cwd: string
  log?: MainLogger
  onFinalExit(): void
}

class SidecarController {
  #child: ChildProcessWithoutNullStreams | null = null
  #listeners = new Set<(event: SidecarEvent) => void>()
  #restartCount = 0
  #stopRequested = false
  #restartTimer: ReturnType<typeof setTimeout> | null = null
  #settled = false
  #resolveFinished!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void
  #finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveOk) => {
    this.#resolveFinished = resolveOk
  })

  readonly handle: SidecarHandle

  constructor(private readonly controller: ControllerOptions) {
    const controllerRef = this
    this.handle = {
      name: controller.options.name,
      get pid() { return controllerRef.#child?.pid ?? null },
      get running() { return controllerRef.#child !== null },
      get finished() { return controllerRef.#finished },
      onEvent: (listener) => {
        this.#listeners.add(listener)
        const pid = this.#child?.pid
        if (pid) queueMicrotask(() => {
          if (this.#listeners.has(listener)) listener({ type: 'started', name: this.handle.name, pid })
        })
        return () => this.#listeners.delete(listener)
      },
      stop: (timeoutMs) => this.stop(timeoutMs),
    }
  }

  start(): void {
    if (this.#stopRequested) return
    const child = spawn(this.controller.executable, this.controller.options.args ?? [], {
      cwd: this.controller.cwd,
      env: sidecarEnvironment(this.controller.options.env),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => this.#emit({
      type: 'stdout', name: this.handle.name, data: boundedOutput(data),
    }))
    child.stderr.on('data', (data: string) => this.#emit({
      type: 'stderr', name: this.handle.name, data: boundedOutput(data),
    }))
    child.on('error', (error) => {
      this.#emit({ type: 'error', name: this.handle.name, message: error.message })
      this.controller.log?.error('sidecar process error', { name: this.handle.name, error })
    })
    // `close` follows both a normal `exit` and a failed spawn `error`, so the
    // handle always settles even when the OS rejects the executable.
    child.once('close', (code, signal) => this.#onExit(child, code, signal))
    const pid = child.pid
    if (!pid) return
    this.#emit({ type: 'started', name: this.handle.name, pid })
    this.controller.log?.info('sidecar started', { name: this.handle.name, pid })
  }

  async stop(timeoutMs = DEFAULT_STOP_TIMEOUT_MS): Promise<void> {
    validateStopTimeout(timeoutMs)
    this.#stopRequested = true
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = null
      this.#settle(null, null)
      return
    }
    const child = this.#child
    if (!child) return this.#finished.then(() => {})
    child.stdin.end()
    child.kill('SIGTERM')
    if (await settlesWithin(this.#finished, timeoutMs)) return
    child.kill('SIGKILL')
    await settlesWithin(this.#finished, Math.min(5_000, timeoutMs))
  }

  #onExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.#child !== child) return
    this.#child = null
    const restart = this.controller.options.restart
    const shouldRestart = !this.#stopRequested
      && code !== 0
      && this.#restartCount < (restart?.maxRestarts ?? 0)
    this.#emit({ type: 'exit', name: this.handle.name, code, signal, restarting: shouldRestart })
    this.controller.log?.[shouldRestart ? 'warn' : code === 0 ? 'info' : 'error'](
      'sidecar exited',
      { name: this.handle.name, code, signal, restarting: shouldRestart },
    )
    if (!shouldRestart) {
      this.#settle(code, signal)
      return
    }
    this.#restartCount++
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null
      try {
        this.start()
      } catch (error) {
        this.#emit({ type: 'error', name: this.handle.name, message: errorMessage(error) })
        this.#settle(null, null)
      }
    }, restart?.delayMs ?? 500)
    this.#restartTimer.unref?.()
  }

  #emit(event: SidecarEvent): void {
    for (const listener of this.#listeners) {
      try { listener(event) } catch { /* listener failures never break supervision */ }
    }
  }

  #settle(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#settled) return
    this.#settled = true
    this.controller.onFinalExit()
    this.#resolveFinished({ code, signal })
  }
}

async function resolveContainedExecutable(root: string, resource: string): Promise<string> {
  if (!resource || resource.includes('\0') || isAbsolute(resource)) {
    throw new TypeError('sidecar resource must be a non-empty relative path')
  }
  const candidate = await realpath(resolve(root, resource)).catch(() => null)
  if (!candidate || !isWithin(root, candidate)) {
    throw new Error('sidecar resource must resolve below resourcesPath')
  }
  const metadata = await stat(candidate)
  if (!metadata.isFile()) throw new Error('sidecar resource must be a regular file')
  if (process.platform !== 'win32') {
    await access(candidate, constants.X_OK).catch(() => {
      throw new Error('sidecar resource is not executable')
    })
  }
  return candidate
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root
  const normalizedCandidate = process.platform === 'win32' ? candidate.toLowerCase() : candidate
  const relation = relative(normalizedRoot, normalizedCandidate)
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
}

function selectWorkingDirectory(
  resources: string,
  paths: SidecarSupervisorOptions['paths'],
  cwd: SidecarWorkingDirectory = 'resources',
): string {
  return cwd === 'resources' ? resources : paths[cwd]
}

function validateSpawnOptions(options: SidecarSpawnOptions): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.name)) {
    throw new TypeError('sidecar name must be 1-64 safe characters')
  }
  const args = options.args ?? []
  if (args.length > MAX_ARGS) throw new TypeError(`sidecar args exceed ${MAX_ARGS} entries`)
  for (const argument of args) validateBoundedString(argument, MAX_ARG_BYTES, 'sidecar argument')
  const env = Object.entries(options.env ?? {})
  if (env.length > MAX_ENV_ENTRIES) throw new TypeError(`sidecar env exceeds ${MAX_ENV_ENTRIES} entries`)
  for (const [key, value] of env) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new TypeError(`invalid sidecar env name ${key}`)
    if (RESERVED_SIDECAR_ENV_KEYS.has(key)) {
      throw new TypeError(`sidecar env ${key} is reserved by Murasaki and cannot be forwarded`)
    }
    validateBoundedString(value, MAX_ENV_VALUE_BYTES, `sidecar env ${key}`)
  }
  if (options.restart) {
    if (!Number.isSafeInteger(options.restart.maxRestarts)
      || options.restart.maxRestarts < 0
      || options.restart.maxRestarts > MAX_RESTARTS) {
      throw new TypeError(`sidecar maxRestarts must be an integer from 0 to ${MAX_RESTARTS}`)
    }
    const delay = options.restart.delayMs ?? 500
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > 60_000) {
      throw new TypeError('sidecar restart delayMs must be an integer from 0 to 60000')
    }
  }
}

/**
 * Preserve the host environment for normal executable discovery and locale
 * behaviour, but remove framework bearer/signing credentials before merging
 * the developer's explicitly validated sidecar environment.
 */
function sidecarEnvironment(overrides: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of RESERVED_SIDECAR_ENV_KEYS) delete env[key]
  return { ...env, ...overrides }
}

function validateBoundedString(value: unknown, maxBytes: number, label: string): void {
  if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value) > maxBytes) {
    throw new TypeError(`${label} must be a NUL-free string no larger than ${maxBytes} bytes`)
  }
}

function validateStopTimeout(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_STOP_TIMEOUT_MS) {
    throw new TypeError(`sidecar stop timeout must be an integer from 1 to ${MAX_STOP_TIMEOUT_MS}`)
  }
}

function boundedOutput(value: string): string {
  const bytes = Buffer.from(value)
  return bytes.byteLength <= 64 * 1024
    ? value
    : `${bytes.subarray(0, 64 * 1024).toString('utf8')}…[truncated]`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<false>((resolveOk) => {
    timer = setTimeout(() => resolveOk(false), timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([promise.then(() => true as const), timedOut])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
