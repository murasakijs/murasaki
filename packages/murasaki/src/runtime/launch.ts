/**
 * Shared bounds and internal transport for cold-start / dev launch arguments.
 *
 * Two producers feed `MainContext.launch`: the native launcher in packaged
 * builds (via `MainRuntimeOptions.launch`) and the `murasaki dev -- <app args>`
 * CLI in development (via the env transport below). Both funnel through
 * {@link sanitizeLaunchArgv} so identical, defensive bounds apply everywhere.
 */

/** Maximum launch argv entries retained; extras beyond this are dropped. */
export const MAX_LAUNCH_ARGS = 64
/** Maximum UTF-8 bytes per launch argv entry; oversized entries are dropped. */
export const MAX_LAUNCH_ARG_BYTES = 8192
/** Maximum UTF-8 bytes of the encoded argv JSON array retained. */
export const MAX_LAUNCH_TOTAL_BYTES = 16 * 1024

/**
 * Internal env var carrying the `murasaki dev` app-argument suffix from the CLI
 * parent into the spawned Vite dev child. Private transport, not a public
 * contract. It lives in the env namespace (never the child's argv) so a
 * forwarded app flag such as `--port` cannot collide with the dev server's own
 * `--port`, and it is consumed and DELETED (see {@link consumeDevLaunchArgv})
 * before any app-owned sidecar — which inherits `process.env` — can spawn. This
 * mirrors the packaged one-shot launch-file transport in
 * assets/prod-server.mjs.
 */
export const DEV_LAUNCH_ENV = 'MURASAKI_DEV_LAUNCH'

/** UTF-8 byte ceiling for the encoded transport payload (defense in depth). */
const MAX_DEV_LAUNCH_BYTES = MAX_LAUNCH_TOTAL_BYTES

/** Immutable cold-start launch snapshot shared by every runtime in a process. */
export interface LaunchSnapshot {
  readonly argv: readonly string[]
  readonly cwd: string
}

/** Drops non-strings and oversized entries, then caps the retained count. */
export function sanitizeLaunchArgv(rawArgv: unknown): string[] {
  const argv: string[] = []
  if (!Array.isArray(rawArgv)) return argv
  for (const value of rawArgv) {
    if (typeof value !== 'string') continue
    if (Buffer.byteLength(value, 'utf8') > MAX_LAUNCH_ARG_BYTES) continue
    if (argv.length >= MAX_LAUNCH_ARGS) break
    const candidate = [...argv, value]
    // Measure the actual JSON transport, not raw string lengths: quotes,
    // backslashes, and control characters expand during serialization.
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_LAUNCH_TOTAL_BYTES) break
    argv.push(value)
  }
  return argv
}

/**
 * Extracts the app-argument suffix from a `murasaki dev` CLI argument list:
 * everything after the FIRST standalone `--` delimiter, sanitized. CLI flags
 * before the delimiter (dev's own options) never leak. Returns `[]` when no
 * `--` is present.
 */
export function parseDevAppArgv(cliArgv: readonly string[]): string[] {
  const delimiter = cliArgv.indexOf('--')
  if (delimiter === -1) return []
  return sanitizeLaunchArgv(cliArgv.slice(delimiter + 1))
}

/**
 * Encodes a sanitized argv suffix for the internal env transport. Returns `''`
 * when the suffix is empty so the caller can omit the env var entirely and keep
 * plain `murasaki dev`'s empty-launch behavior.
 */
export function encodeDevLaunchArgv(argv: readonly string[]): string {
  const sanitized = sanitizeLaunchArgv(argv)
  return sanitized.length > 0 ? JSON.stringify(sanitized) : ''
}

/**
 * Reads, bounds, and DELETES the dev launch transport from `env` (default
 * `process.env`). Deleting on the same read guarantees the value is gone before
 * app-owned sidecars — which inherit `process.env` — can spawn. Malformed,
 * missing, or oversized payloads yield `[]`.
 */
export function consumeDevLaunchArgv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[DEV_LAUNCH_ENV]
  delete env[DEV_LAUNCH_ENV]
  if (typeof raw !== 'string' || raw.length === 0) return []
  if (Buffer.byteLength(raw, 'utf8') > MAX_DEV_LAUNCH_BYTES) return []
  try {
    return sanitizeLaunchArgv(JSON.parse(raw))
  } catch {
    return []
  }
}
