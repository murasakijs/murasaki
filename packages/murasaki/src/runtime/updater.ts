/**
 * The auto-updater engine — the Node-side half of the check/download/install
 * flow described in the frozen contract (`/private/tmp/.../updater-contract.md`,
 * §0/§6/§7/§8). This module owns:
 *
 *  - the `UpdateState` state machine (§6),
 *  - `check()`: fetch + Ed25519-verify + semver-compare the manifest,
 *  - `download()`: stream the platform asset to a staging file, verify its
 *    sha256,
 *  - `install()`: write the `<resourcesDir>/.murasaki-apply.json` handoff
 *    file (§7 REVISED) and return — it spawns NOTHING. The launcher (not
 *    Node) spawns the apply-helper on its way out, because a process Node
 *    spawns on Windows can't escape the launcher's orphan-killing Job
 *    Object (see the contract's §7 REVISED for why). The React client quits
 *    the app via `quit()` / `{ kind: "appQuit" }`, per §7, which is what
 *    gives the launcher its "on the way out" moment to act on the handoff
 *    file,
 *  - `/__murasaki/update/*` HTTP route dispatch (§6), consumed by
 *    `vite-plugin/updater.ts` in dev.
 *
 * Per §0, this only runs in Node — the updater never round-trips through the
 * napi IPC bridge (that path is dead in both dev and prod).
 *
 * `assets/prod-server.mjs` needs this exact same behavior in prod, but it
 * ships as a single standalone `.mjs` file with no import graph (see its own
 * header comment and `cli/bundle.ts`'s `metaJson`/bundling — nothing besides
 * that one file gets copied into the packaged resources dir). So prod mounts
 * a hand-mirrored, plain-JS re-implementation of everything below directly
 * in `prod-server.mjs`, the same way `handleAction`/`handleApiRoute` there
 * already mirror (never import) `vite-plugin/server-actions.ts` and
 * `vite-plugin/api-routes.ts`. Keep the two in sync by hand; this module is
 * the canonical version.
 */
import { createHash, createPublicKey, verify as verifyEd25519 } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ResolvedUpdater } from '../config.js'

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' | 'error'
  /** Running app version. */
  current: string
  latest?: string
  notes?: string
  mandatory?: boolean
  /** 0..1, only meaningful while `status === 'downloading'`. */
  progress?: number
  error?: string
}

export interface UpdaterEngineOptions {
  /** `null` means the app has no `updater` configured — check()/download()/install() all report a clean "not configured" error rather than crashing. */
  resolvedUpdater: ResolvedUpdater | null
  /** The running app's own version — NOT `@murasakijs/native`'s `version()` (that's the native crate's version, a different number). Read from `murasaki-meta.json` in prod, from `murasaki.config.ts`'s `version` in dev. */
  currentVersion: string
  /** `'dev'` fails `download()`/`install()` fast (§6) — there's no bundled app/launcher to apply an update to. `check()` still works in both modes. */
  mode: 'dev' | 'prod'
  /** Prod only: the packaged resources dir (`Contents/Resources` on macOS, `resources/` on Windows — Node's own `cwd`, per §7). Required for `install()`, which writes `.murasaki-apply.json` here; the launcher (not Node) derives the launcher/exe/target/relaunch paths from this same directory. */
  resourcesDir?: string
  /** Where downloaded payloads are staged before install. Defaults to a directory under `os.tmpdir()`. */
  stagingDir?: string
}

export interface UpdaterEngine {
  getState(): UpdateState
  /** Registers a listener fired with the full new state on every transition. Returns an unsubscribe function. */
  onChange(listener: (state: UpdateState) => void): () => void
  check(): Promise<UpdateState>
  /** Starts (but does not await to completion by the caller — the HTTP layer calls this without awaiting) the download. Progress/completion are observable via `onChange`/`getState`. */
  download(): Promise<void>
  install(): Promise<{ ok: true } | { ok: false; error: string }>
  /** Stops the `checkInterval` timer, if one was started. Idempotent. Does not affect an in-flight check. */
  dispose(): void
}

/** Exact error string contract §6 requires for `download`/`install` in dev mode. */
const DEV_UNSUPPORTED_MESSAGE = 'Updates only apply to a bundled app. Run `murasaki bundle` first.'

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function createUpdaterEngine(opts: UpdaterEngineOptions): UpdaterEngine {
  const listeners = new Set<(state: UpdateState) => void>()
  let state: UpdateState = { status: 'idle', current: opts.currentVersion }
  let manifestInfo: { version: string; notes?: string; mandatory?: boolean } | undefined
  let manifestAsset: { url: string; sha256: string } | undefined
  let stagedPath: string | undefined
  let stagedSha256: string | undefined

  function setState(next: UpdateState): UpdateState {
    state = next
    for (const listener of listeners) listener(state)
    return state
  }

  function getState(): UpdateState {
    return state
  }

  function onChange(listener: (state: UpdateState) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  // Guards against overlapping checks: `checkOnStart`, the `checkInterval`
  // timer, and a manual POST /check (contract §6) can all fire independently
  // of each other. Without this, an interval tick landing mid-manual-check
  // would start a second concurrent fetch and the two responses could
  // resolve out of order, clobbering `state` with a stale result.
  let inFlightCheck: Promise<UpdateState> | undefined

  function check(): Promise<UpdateState> {
    if (inFlightCheck) return inFlightCheck
    inFlightCheck = runCheck().finally(() => {
      inFlightCheck = undefined
    })
    return inFlightCheck
  }

  async function runCheck(): Promise<UpdateState> {
    setState({ status: 'checking', current: opts.currentVersion })

    if (!opts.resolvedUpdater) {
      return setState({
        status: 'error',
        current: opts.currentVersion,
        error: 'updater is not configured — set `updater` in murasaki.config.ts',
      })
    }

    try {
      const { manifestUrl, publicKey } = opts.resolvedUpdater
      const manifestRes = await fetch(manifestUrl)
      if (!manifestRes.ok) {
        throw new Error(`failed to fetch manifest: HTTP ${manifestRes.status}`)
      }
      const manifestBytes = Buffer.from(await manifestRes.arrayBuffer())

      const sigRes = await fetch(`${manifestUrl}.sig`)
      if (!sigRes.ok) {
        throw new Error(`failed to fetch manifest signature: HTTP ${sigRes.status}`)
      }
      const sigText = await sigRes.text()

      // Verify BEFORE parsing — the raw bytes are what was signed (contract
      // §1). A bad/missing signature is a hard error, never a silent pass:
      // this Ed25519 check is the only authenticity guarantee this project
      // has (there is no Authenticode signing on Windows at all).
      if (!verifyManifestSignature(manifestBytes, sigText, publicKey)) {
        throw new Error('manifest signature verification failed — refusing to trust this manifest')
      }

      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      if (typeof manifest?.version !== 'string' || typeof manifest?.assets !== 'object') {
        throw new Error('manifest is malformed (missing "version" or "assets")')
      }

      if (compareVersions(manifest.version, opts.currentVersion) <= 0) {
        manifestInfo = undefined
        manifestAsset = undefined
        return setState({ status: 'not-available', current: opts.currentVersion, latest: manifest.version })
      }

      const targetKey = `${process.platform}-${process.arch}`
      const asset = manifest.assets[targetKey]
      if (!asset || typeof asset.url !== 'string' || typeof asset.sha256 !== 'string') {
        // No asset for the running platform+arch → "no update for you", not
        // an error (contract §1/§6).
        manifestInfo = undefined
        manifestAsset = undefined
        return setState({ status: 'not-available', current: opts.currentVersion, latest: manifest.version })
      }

      manifestInfo = { version: manifest.version, notes: manifest.notes, mandatory: manifest.mandatory }
      manifestAsset = { url: asset.url, sha256: asset.sha256 }
      return setState({
        status: 'available',
        current: opts.currentVersion,
        latest: manifestInfo.version,
        notes: manifestInfo.notes,
        mandatory: manifestInfo.mandatory,
      })
    } catch (err) {
      return setState({ status: 'error', current: opts.currentVersion, error: errorMessage(err) })
    }
  }

  async function download(): Promise<void> {
    if (opts.mode === 'dev') {
      setState({ status: 'error', current: opts.currentVersion, error: DEV_UNSUPPORTED_MESSAGE })
      return
    }
    if (!manifestAsset) {
      setState({
        status: 'error',
        current: opts.currentVersion,
        error: 'no update available to download — call check() first',
      })
      return
    }

    setState({ status: 'downloading', current: opts.currentVersion, progress: 0 })
    try {
      const stagingDir = opts.stagingDir ?? join(tmpdir(), 'murasaki-update')
      await mkdir(stagingDir, { recursive: true })
      const dest = join(stagingDir, basenameFromUrl(manifestAsset.url))
      await rm(dest, { force: true })

      await streamDownload(manifestAsset.url, dest, (progress) => {
        setState({ status: 'downloading', current: opts.currentVersion, progress })
      })

      const digest = await sha256File(dest)
      if (digest.toLowerCase() !== manifestAsset.sha256.toLowerCase()) {
        await rm(dest, { force: true })
        throw new Error('downloaded payload failed sha256 verification')
      }

      stagedPath = dest
      stagedSha256 = digest
      setState({
        status: 'ready',
        current: opts.currentVersion,
        latest: manifestInfo?.version,
        notes: manifestInfo?.notes,
        mandatory: manifestInfo?.mandatory,
      })
    } catch (err) {
      stagedPath = undefined
      stagedSha256 = undefined
      setState({ status: 'error', current: opts.currentVersion, error: errorMessage(err) })
    }
  }

  async function install(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (opts.mode === 'dev') {
      setState({ status: 'error', current: opts.currentVersion, error: DEV_UNSUPPORTED_MESSAGE })
      return { ok: false, error: DEV_UNSUPPORTED_MESSAGE }
    }
    if (!stagedPath || !stagedSha256) {
      const error = 'no update staged — call download() and wait for it to finish first'
      setState({ status: 'error', current: opts.currentVersion, error })
      return { ok: false, error }
    }
    if (!opts.resourcesDir) {
      const error = 'updater: missing resourcesDir — install() only works from a bundled app'
      setState({ status: 'error', current: opts.currentVersion, error })
      return { ok: false, error }
    }

    try {
      // §7 REVISED: Node spawns NOTHING here. On Windows, a process Node
      // spawns is placed in the same `KILL_ON_JOB_CLOSE` Job Object as Node
      // itself (see launcher.rs's `win_job` module), so a helper spawned
      // from here would be killed the instant the launcher quits — before
      // it finishes waiting/applying. Instead, Node just leaves a handoff
      // file for the launcher, which is not in that job, to act on once it
      // sees the app quit (contract §7 REVISED step 6). The launcher derives
      // `--target`/`--relaunch`/`--wait-pid` itself from its own resolved
      // install location and pid — this file deliberately carries only the
      // two things only Node knows.
      const handoffPath = join(opts.resourcesDir, '.murasaki-apply.json')
      await writeFile(handoffPath, JSON.stringify({ payload: stagedPath, sha256: stagedSha256 }))
      return { ok: true }
    } catch (err) {
      const error = errorMessage(err)
      setState({ status: 'error', current: opts.currentVersion, error })
      return { ok: false, error }
    }
  }

  // `checkOnStart`/`checkInterval` (contract §3) — resolved by
  // `resolveUpdater()` into `checkOnStart`/`checkIntervalMs`, but until now
  // nothing ever read them: `updater: true`'s default `checkOnStart: true`
  // silently performed no check at launch. Wired here, in the one engine
  // shared by dev (`vite-plugin/updater.ts`) and prod
  // (`assets/prod-server.mjs` imports this file's compiled output directly),
  // so both get it for free.
  let intervalTimer: ReturnType<typeof setInterval> | undefined

  if (opts.resolvedUpdater) {
    if (opts.resolvedUpdater.checkOnStart) {
      // Fire-and-forget: `check()` always resolves (its own try/catch routes
      // network/verification failures into an `error` state) and never
      // rejects, so there's nothing to await or catch here — a check that
      // can't reach the network degrades the state machine, it doesn't
      // throw.
      check()
    }
    if (typeof opts.resolvedUpdater.checkIntervalMs === 'number') {
      // `.unref()`: this timer must never be the reason the process stays
      // alive — dev's Vite server and prod's Node process both have their
      // own lifecycle/shutdown paths that don't know about the updater.
      intervalTimer = setInterval(() => {
        check()
      }, opts.resolvedUpdater.checkIntervalMs)
      intervalTimer.unref()
    }
  }

  function dispose(): void {
    if (intervalTimer) {
      clearInterval(intervalTimer)
      intervalTimer = undefined
    }
  }

  return { getState, onChange, check, download, install, dispose }
}

/** Wraps the raw 32-byte base64 public key (contract §2) as SPKI DER and verifies a detached Ed25519 signature over the raw manifest bytes. */
function verifyManifestSignature(manifestBytes: Buffer, sigBase64: string, publicKeyB64: string): boolean {
  try {
    const rawKey = Buffer.from(publicKeyB64.trim(), 'base64')
    if (rawKey.length !== 32) return false
    const publicKey = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, rawKey]),
      format: 'der',
      type: 'spki',
    })
    const signature = Buffer.from(sigBase64.trim(), 'base64')
    return verifyEd25519(null, manifestBytes, publicKey, signature)
  } catch {
    // A malformed key/signature is exactly as untrustworthy as a mismatched
    // one — never let a parse error fall through as "unverified but ok".
    return false
  }
}

/**
 * Minimal semver precedence compare (major.minor.patch[-prerelease]),
 * sufficient for "is the manifest newer than what's running" — this project
 * takes on no new npm dependency for it (contract §2's "no new deps" applies
 * to the whole updater, not just the crypto).  Returns >0 if `a` is newer
 * than `b`, <0 if older, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i]
  }
  if (pa.pre.length === 0 && pb.pre.length > 0) return 1
  if (pa.pre.length > 0 && pb.pre.length === 0) return -1
  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

function parseSemver(version: string): { core: [number, number, number]; pre: string[] } {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim())
  if (!match) return { core: [0, 0, 0], pre: [] }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  }
}

/** Streams `url` to `dest`, reporting 0..1 progress as bytes arrive (only when the response carries `content-length`). */
async function streamDownload(url: string, dest: string, onProgress: (progress: number) => void): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`failed to download update: HTTP ${res.status}`)
  }
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress(Math.min(received / total, 1))
  })
  await pipeline(nodeStream, createWriteStream(dest))
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function basenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    return pathname.split('/').pop() || 'update-payload'
  } catch {
    return 'update-payload'
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── HTTP routes (contract §6) ──────────────────────────────────────────────

const UPDATE_PATH_PREFIX = '/__murasaki/update/'

/**
 * Dispatches the four `/__murasaki/update/*` routes against `engine`.
 * Returns `true` if the request matched (and was fully handled — including
 * unmatched methods/sub-paths under the prefix, which get a 404/405) so the
 * caller (a Connect middleware in dev) knows whether to fall through to
 * `next()`.
 */
export function createUpdateRequestHandler(
  engine: UpdaterEngine,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async function handleUpdateRequest(req, res) {
    const pathname = (req.url ?? '/').split('?')[0]
    if (!pathname.startsWith(UPDATE_PATH_PREFIX)) return false

    if (pathname === `${UPDATE_PATH_PREFIX}events`) {
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.end()
        return true
      }
      handleEvents(engine, req, res)
      return true
    }

    if (pathname === `${UPDATE_PATH_PREFIX}check`) {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end()
        return true
      }
      const nextState = await engine.check()
      sendJson(res, 200, nextState)
      return true
    }

    if (pathname === `${UPDATE_PATH_PREFIX}download`) {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end()
        return true
      }
      // Fire-and-forget: the route returns immediately (202) per contract
      // §6; progress/completion/failure are all observable over SSE. Errors
      // are captured into the state machine by `download()` itself, not
      // thrown here — this `.catch` only guards against an unexpected bug
      // becoming an unhandled rejection.
      engine.download().catch(() => {})
      sendJson(res, 202, engine.getState())
      return true
    }

    if (pathname === `${UPDATE_PATH_PREFIX}install`) {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end()
        return true
      }
      const result = await engine.install()
      sendJson(res, result.ok ? 200 : 500, result)
      return true
    }

    res.statusCode = 404
    res.end()
    return true
  }
}

function handleEvents(engine: UpdaterEngine, req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 200
  res.setHeader('content-type', 'text/event-stream')
  res.setHeader('cache-control', 'no-cache')
  res.setHeader('connection', 'keep-alive')
  res.flushHeaders?.()

  const send = (state: UpdateState) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`)
  }
  send(engine.getState())
  const off = engine.onChange(send)
  req.on('close', () => {
    off()
  })
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
