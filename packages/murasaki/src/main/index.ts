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
