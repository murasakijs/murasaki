import type { MainLogger } from './logger.js'
import type { SidecarSupervisor } from './sidecar.js'

export {
  createMainLogger,
  type DiagnosticReportOptions,
  type MainLogFields,
  type MainLogger,
  type MainLoggerOptions,
} from './logger.js'

export {
  createSidecarSupervisor,
  type SidecarEvent,
  type SidecarHandle,
  type SidecarRestartPolicy,
  type SidecarSpawnOptions,
  type SidecarSupervisor,
  type SidecarSupervisorOptions,
  type SidecarWorkingDirectory,
} from './sidecar.js'

/** Runtime information passed to the application's long-lived Node main process. */
export interface MainContext {
  appId: string
  productName: string
  version: string
  isPackaged: boolean
  platform: NodeJS.Platform
  arch: string
  projectRoot: string
  resourcesPath: string
  paths: {
    data: string
    cache: string
    logs: string
    temp: string
  }
  /** Structured rotating log plus an opt-in diagnostic report generator. */
  log: MainLogger
  /** Supervises executable resources without a shell and stops them with the app. */
  sidecars: SidecarSupervisor
  /** Aborted after `beforeQuit`, or when the total quit-hook deadline expires. */
  signal: AbortSignal
}

export type QuitReason =
  | 'window-close'
  | 'app-quit'
  | 'signal'
  | 'restart'
  | 'dev-reload'
  | 'startup-failure'

export interface QuitContext extends MainContext {
  reason: QuitReason
}

export interface SecondInstanceEvent {
  /** Arguments passed to the second launcher, including deep-link URLs/files. */
  argv: string[]
  cwd: string
}

export type OpenTarget =
  | { kind: 'url'; url: string; scheme: string }
  | { kind: 'file'; path: string }

export interface OpenRequestEvent {
  /** How this activation reached the primary application instance. */
  activation: 'cold-start' | 'second-instance' | 'os-event'
  /** Native delivery mechanism, useful for diagnostics. */
  transport: 'argv' | 'open-url' | 'open-file'
  /** Normalized registered URLs/files. Treat every value as untrusted input. */
  targets: OpenTarget[]
  /** Working directory for argv-based activations. */
  cwd?: string
}

export interface MainDefinition {
  /** Runs once after the Node main process is ready, before the renderer is shown. */
  ready?(context: MainContext): void | Promise<void>
  /** Runs in the primary instance when another launch is redirected to it. */
  secondInstance?(context: MainContext, event: SecondInstanceEvent): void | Promise<void>
  /** Receives registered URL schemes and files after `ready()` has completed. */
  openRequested?(context: MainContext, event: OpenRequestEvent): void | Promise<void>
  /** Return `false` to cancel a normal quit request. Ignored for forced shutdown. */
  beforeQuit?(context: QuitContext): boolean | void | Promise<boolean | void>
  /** Flush databases, sockets, workers, and other owned resources. */
  shutdown?(context: QuitContext): void | Promise<void>
}

export interface MainEvent<T = unknown> {
  channel: string
  value: T
}

/** Serializable state for a window declared in `murasaki.config.*`. */
export interface MainWindowState {
  label: string
  /** Monotonic native instance generation for this label. */
  generation: number
  primary: boolean
  visible: boolean
  focused: boolean
  minimized: boolean
  maximized: boolean
}

export type MainWindowLifecycleType = 'created' | 'shown' | 'hidden' | 'focused' | 'blurred' | 'closed'

/** Native window lifecycle notification delivered to the Node Main process. */
export interface MainWindowLifecycleEvent {
  type: MainWindowLifecycleType
  label: string
  /** Generation of the native window instance that emitted this event. */
  generation: number
  primary: boolean
  /** `null` after the native window has been destroyed. */
  state: MainWindowState | null
}

type MainWindowMethod = 'list' | 'get' | 'create' | 'show' | 'hide' | 'focus' | 'destroy'

interface MainWindowControlCommand {
  id: string
  method: MainWindowMethod
  label?: string
}

interface WindowControlPending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface WindowControlBus {
  version: 1
  nextId: number
  phase: 'starting' | 'running' | 'stopping'
  commands: MainWindowControlCommand[]
  pending: Map<string, WindowControlPending>
  listeners: Set<(event: MainWindowLifecycleEvent) => void>
}

const MAIN_WINDOW_CONTROL_BUS = Symbol.for('murasaki.main.window-control.v1')
const MAIN_WINDOW_CONTROL_PHASE = Symbol.for('murasaki.main.window-control.phase.v1')
const MAX_WINDOW_CONTROL_COMMANDS = 64
const WINDOW_CONTROL_TIMEOUT_MS = 10_000

function windowControlBus(): WindowControlBus {
  const root = globalThis as typeof globalThis & {
    [MAIN_WINDOW_CONTROL_BUS]?: WindowControlBus
    [MAIN_WINDOW_CONTROL_PHASE]?: WindowControlBus['phase']
  }
  return root[MAIN_WINDOW_CONTROL_BUS] ??= {
    version: 1,
    nextId: 1,
    phase: root[MAIN_WINDOW_CONTROL_PHASE] ?? 'starting',
    commands: [],
    pending: new Map(),
    listeners: new Set(),
  }
}

function validateWindowLabel(label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label)) {
    throw new TypeError(
      'window label must be 1-64 characters using letters, numbers, dot, underscore, or hyphen',
    )
  }
}

function invokeWindowControl<T>(method: MainWindowMethod, label?: string): Promise<T> {
  if (label !== undefined) validateWindowLabel(label)
  const bus = windowControlBus()
  if (bus.phase === 'starting') {
    return Promise.reject(new Error(
      'Node Main window commands are unavailable inside ready(); subscribe there and issue commands after ready resolves',
    ))
  }
  if (bus.phase === 'stopping') {
    return Promise.reject(new Error('Node Main window commands are unavailable during shutdown'))
  }
  if (bus.pending.size >= MAX_WINDOW_CONTROL_COMMANDS) {
    return Promise.reject(new Error('native window command queue is full'))
  }

  const id = `${process.pid}-${bus.nextId++}`
  return new Promise<T>((resolveOk, rejectFail) => {
    const timer = setTimeout(() => {
      bus.pending.delete(id)
      rejectFail(new Error(`native window command ${method} timed out`))
    }, WINDOW_CONTROL_TIMEOUT_MS)
    bus.pending.set(id, {
      resolve: (value) => resolveOk(value as T),
      reject: rejectFail,
      timer,
    })
    bus.commands.push({ id, method, ...(label === undefined ? {} : { label }) })
  })
}

/**
 * Imperative control for windows declared in `murasaki.config.*`.
 *
 * The transport is native-host-only and authenticated with the per-launch
 * runtime token; renderer pages cannot call this API or forge lifecycle events.
 */
export const windows = {
  list(): Promise<MainWindowState[]> {
    return invokeWindowControl('list')
  },
  get(label: string): Promise<MainWindowState | null> {
    return invokeWindowControl('get', label)
  },
  /** Creates a configured, currently dormant secondary window. */
  create(label: string): Promise<MainWindowState> {
    return invokeWindowControl('create', label)
  },
  show(label: string): Promise<void> {
    return invokeWindowControl('show', label)
  },
  hide(label: string): Promise<void> {
    return invokeWindowControl('hide', label)
  },
  focus(label: string): Promise<void> {
    return invokeWindowControl('focus', label)
  },
  /** Destroys a live secondary window. The primary window cannot be destroyed. */
  destroy(label: string): Promise<void> {
    return invokeWindowControl('destroy', label)
  },
  subscribe(listener: (event: MainWindowLifecycleEvent) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('window lifecycle listener must be a function')
    const bus = windowControlBus()
    bus.listeners.add(listener)
    return () => bus.listeners.delete(listener)
  },
}

type MainEventListener = (event: MainEvent) => void
const MAIN_EVENT_BUS = Symbol.for('murasaki.main.events.v1')

function eventBus(): { listeners: Set<MainEventListener> } {
  const root = globalThis as typeof globalThis & {
    [MAIN_EVENT_BUS]?: { listeners: Set<MainEventListener> }
  }
  return root[MAIN_EVENT_BUS] ??= { listeners: new Set() }
}

/** Publishes a typed application event from Node Main to subscribed renderers. */
export function emitMainEvent<T>(channel: string, value: T): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(channel)) {
    throw new TypeError('main event channel must be 1-128 safe identifier characters')
  }
  for (const listener of eventBus().listeners) listener({ channel, value })
}

/** @internal Framework transport subscription; applications should emit only. */
export function subscribeMainEvents(listener: MainEventListener): () => void {
  eventBus().listeners.add(listener)
  return () => eventBus().listeners.delete(listener)
}

/**
 * Declares the application's long-lived Node main process lifecycle.
 *
 * @example
 * ```ts
 * // src/main.ts
 * import { defineMain } from 'murasaki/main'
 *
 * export default defineMain({
 *   async ready({ paths, signal }) {
 *     // Open databases, start WebSocket/TCP servers, workers, etc.
 *   },
 *   async shutdown() {
 *     // Flush and close owned resources.
 *   },
 * })
 * ```
 */
export function defineMain(definition: MainDefinition): MainDefinition {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('defineMain() expects a lifecycle object')
  }
  return definition
}
