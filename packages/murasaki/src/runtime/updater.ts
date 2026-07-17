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
 *    the app via the capability-checked `quit()` / `app.quit` native call.
 *    This gives the launcher its "on the way out" moment to act on the
 *    handoff file,
 *  - `/__murasaki/update/*` HTTP route dispatch (§6), consumed by
 *    `vite-plugin/updater.ts` in dev.
 *
 * Per §0, this only runs in Node — the updater never round-trips through the
 * napi IPC bridge (that path is dead in both dev and prod).
 *
 * `assets/prod-server.mjs` imports the compiled form of this module from the
 * packaged `updater-engine.mjs` resource. This module is therefore the sole
 * implementation shared by dev and production; do not mirror its security-
 * sensitive manifest/download logic into the standalone server.
 */
import { createHash, createPublicKey, randomBytes, randomUUID, verify as verifyEd25519 } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
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
  /** Network timeout for each manifest/signature request. Primarily exposed so embedders can tune unusually slow self-hosted endpoints. */
  requestTimeoutMs?: number
  /** End-to-end timeout for an update payload download. */
  downloadTimeoutMs?: number
  /** Maximum accepted raw manifest size. */
  maxManifestBytes?: number
  /** Maximum accepted detached signature response size. */
  maxSignatureBytes?: number
  /** Maximum accepted update payload size. Enforced even without `content-length`. */
  maxPayloadBytes?: number
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
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const DEFAULT_MAX_MANIFEST_BYTES = 1024 * 1024
const DEFAULT_MAX_SIGNATURE_BYTES = 16 * 1024
const DEFAULT_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024 * 1024
/** Fallback for `ResolvedUpdater.maxManifestAgeDays` if a caller hands the engine an older/incomplete resolved shape. `resolveUpdater()` itself always fills this in. */
const DEFAULT_MAX_MANIFEST_AGE_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000
/** A manifest's `generatedAt` up to this far in the future is tolerated as ordinary clock skew; beyond it is treated as a tampering/misconfiguration signal. */
const CLOCK_SKEW_TOLERANCE_MS = 24 * 60 * 60 * 1000
/** Persisted per-install random id used only to compute a stable staged-rollout bucket (contract-adjacent — see the auto-update guide's "Staged rollout" section). Colocated with `.murasaki-apply.json` (see `install()`). */
const CLIENT_ID_FILENAME = 'update-client-id'

export function createUpdaterEngine(opts: UpdaterEngineOptions): UpdaterEngine {
  const listeners = new Set<(state: UpdateState) => void>()
  let state: UpdateState = { status: 'idle', current: opts.currentVersion }
  let manifestInfo: { version: string; notes?: string; mandatory?: boolean } | undefined
  let manifestAsset: { url: string; sha256: string } | undefined
  let stagedPath: string | undefined
  let stagedSha256: string | undefined
  let stagedDirectory: string | undefined
  // Cached so every check() reuses the same id/bucket instead of re-reading
  // (or re-creating) the file, and so concurrent checks join one resolution.
  let clientIdPromise: Promise<string> | undefined

  const requestTimeoutMs = positiveLimit(opts.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs')
  const downloadTimeoutMs = positiveLimit(
    opts.downloadTimeoutMs,
    DEFAULT_DOWNLOAD_TIMEOUT_MS,
    'downloadTimeoutMs',
  )
  const maxManifestBytes = positiveLimit(
    opts.maxManifestBytes,
    DEFAULT_MAX_MANIFEST_BYTES,
    'maxManifestBytes',
  )
  const maxSignatureBytes = positiveLimit(
    opts.maxSignatureBytes,
    DEFAULT_MAX_SIGNATURE_BYTES,
    'maxSignatureBytes',
  )
  const maxPayloadBytes = positiveLimit(
    opts.maxPayloadBytes,
    DEFAULT_MAX_PAYLOAD_BYTES,
    'maxPayloadBytes',
  )

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
      const { manifestUrl, publicKey, publicKeys, maxManifestAgeDays } = opts.resolvedUpdater

      // Defense in depth: config.ts's validateUpdaterConfig already rejects a
      // non-https `updater.endpoint` (except loopback, for local testing) at
      // config-validation time. This is the fetch-time half of that pair —
      // it protects against a config bypass (a hand-built `ResolvedUpdater`,
      // or a future code path that skips validateConfig).
      assertSecureManifestUrl(manifestUrl)

      const manifestBytes = await fetchLimitedBytes(
        manifestUrl,
        'manifest',
        maxManifestBytes,
        requestTimeoutMs,
      )
      const sigBytes = await fetchLimitedBytes(
        `${manifestUrl}.sig`,
        'manifest signature',
        maxSignatureBytes,
        requestTimeoutMs,
      )
      const sigText = sigBytes.toString('utf8')

      // `keyId` (contract-adjacent — see the auto-update guide's rotation
      // runbook) is only a HINT for which pinned key to try first: it's read
      // from the not-yet-verified bytes, so it carries no trust of its own.
      // `verifyManifestSignature` always falls back to every pinned key
      // regardless of whether the hint matched.
      const keyIdHint = peekManifestKeyId(manifestBytes)
      const pinnedKeys = publicKeys && publicKeys.length > 0 ? publicKeys : [publicKey]

      // Verify BEFORE parsing — the raw bytes are what was signed (contract
      // §1). A bad/missing signature is a hard error, never a silent pass:
      // this Ed25519 check is the only authenticity guarantee this project
      // has (there is no Authenticode signing on Windows at all).
      if (!verifyManifestSignature(manifestBytes, sigText, pinnedKeys, keyIdHint)) {
        throw new Error('manifest signature verification failed — refusing to trust this manifest')
      }

      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      if (typeof manifest?.version !== 'string' || typeof manifest?.assets !== 'object') {
        throw new Error('manifest is malformed (missing "version" or "assets")')
      }

      // Anti-freeze/replay guard: refuse a manifest whose declared
      // generation time is stale (an attacker who can only replay old,
      // still-validly-signed manifests can otherwise freeze a fleet on a
      // known-vulnerable version forever) or implausibly far in the future
      // (a tampering/misconfiguration signal beyond ordinary clock skew). A
      // manifest with no `generatedAt` at all predates this field and is
      // still accepted, but logs a warning.
      assertManifestFreshness(manifest.generatedAt, maxManifestAgeDays ?? DEFAULT_MAX_MANIFEST_AGE_DAYS)

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

      // Staged rollout: an absent/100 `rollout` always passes. Below 100, a
      // stable per-install bucket decides — this is a distribution knob, not
      // a security boundary, so an excluded client is reported the same as
      // "no update for you" (not-available), never `error`.
      const rolloutPercent = resolveRolloutPercent(manifest.rollout)
      if (rolloutPercent < 100) {
        const clientId = await getClientId()
        const bucket = rolloutBucket(clientId)
        if (bucket >= rolloutPercent) {
          manifestInfo = undefined
          manifestAsset = undefined
          logUpdaterEvent('info', 'updater.rollout.excluded', {
            version: manifest.version,
            rollout: rolloutPercent,
            bucket,
          })
          return setState({ status: 'not-available', current: opts.currentVersion, latest: manifest.version })
        }
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

  /**
   * The stable per-install random id staged rollout buckets on — persisted
   * as `update-client-id`, colocated with `install()`'s `.murasaki-apply.json`
   * handoff file (same directory: `resourcesDir` in prod; dev has no
   * `resourcesDir`, so it falls back to the download staging root). Reused
   * (not regenerated) across restarts so a client's rollout bucket is stable;
   * best-effort persistence — a write failure (e.g. read-only resources dir)
   * still returns an id for this session so rollout gating keeps working.
   */
  function getClientId(): Promise<string> {
    if (!clientIdPromise) clientIdPromise = loadOrCreateClientId()
    return clientIdPromise
  }

  async function loadOrCreateClientId(): Promise<string> {
    const dir = opts.resourcesDir ?? opts.stagingDir ?? join(tmpdir(), 'murasaki-update')
    const path = join(dir, CLIENT_ID_FILENAME)
    try {
      const existing = (await readFile(path, 'utf8')).trim()
      if (UUID_RE.test(existing)) return existing
    } catch {
      // missing/unreadable — create one below
    }
    const id = randomUUID()
    try {
      await mkdir(dir, { recursive: true })
      await writeAtomicPrivateFile(path, id)
    } catch {
      // best-effort — see doc comment above
    }
    return id
  }

  let inFlightDownload: Promise<void> | undefined

  function download(): Promise<void> {
    if (inFlightDownload) return inFlightDownload
    inFlightDownload = runDownload().finally(() => {
      inFlightDownload = undefined
    })
    return inFlightDownload
  }

  async function runDownload(): Promise<void> {
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

    // Snapshot the verified asset. A timer-driven check may complete while a
    // large payload is downloading; it must not change which URL/hash this
    // particular operation verifies.
    const asset = manifestAsset
    const info = manifestInfo
    setState({ status: 'downloading', current: opts.currentVersion, progress: 0 })
    let sessionDirectory: string | undefined
    try {
      const stagingRoot = opts.stagingDir ?? join(tmpdir(), 'murasaki-update')
      await mkdir(stagingRoot, { recursive: true })
      const appKey = createHash('sha256')
        .update(opts.resolvedUpdater?.manifestUrl ?? '')
        .update('\0')
        .update(opts.resolvedUpdater?.publicKey ?? '')
        .digest('hex')
        .slice(0, 12)
      const targetVersion = safePathSegment(info?.version ?? 'unknown')
      sessionDirectory = await mkdtemp(join(stagingRoot, `${appKey}-${targetVersion}-`))
      await chmod(sessionDirectory, 0o700)
      const dest = join(sessionDirectory, basenameFromUrl(asset.url))

      const digest = await streamDownload(
        asset.url,
        dest,
        maxPayloadBytes,
        downloadTimeoutMs,
        (progress) => {
          setState({ status: 'downloading', current: opts.currentVersion, progress })
        },
      )

      if (digest.toLowerCase() !== asset.sha256.toLowerCase()) {
        throw new Error('downloaded payload failed sha256 verification')
      }

      const previousDirectory = stagedDirectory
      stagedPath = dest
      stagedSha256 = digest
      stagedDirectory = sessionDirectory
      sessionDirectory = undefined
      if (previousDirectory && previousDirectory !== stagedDirectory) {
        await rm(previousDirectory, { recursive: true, force: true })
      }
      setState({
        status: 'ready',
        current: opts.currentVersion,
        latest: info?.version,
        notes: info?.notes,
        mandatory: info?.mandatory,
      })
    } catch (err) {
      if (sessionDirectory) await rm(sessionDirectory, { recursive: true, force: true }).catch(() => {})
      if (stagedDirectory) await rm(stagedDirectory, { recursive: true, force: true }).catch(() => {})
      stagedPath = undefined
      stagedSha256 = undefined
      stagedDirectory = undefined
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
      await writeAtomicPrivateFile(
        handoffPath,
        JSON.stringify({ payload: stagedPath, sha256: stagedSha256 }),
      )
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

/**
 * Verifies a detached Ed25519 signature over the raw manifest bytes against
 * every pinned key in `publicKeys` (key rotation — see the auto-update
 * guide's rotation runbook), until one succeeds. `keyIdHint` — read from the
 * not-yet-verified manifest by `peekManifestKeyId` — only reorders which
 * pinned key is tried first; every pinned key is still tried regardless of
 * whether it matches, so a stale/wrong hint can never cause a false reject.
 */
function verifyManifestSignature(
  manifestBytes: Buffer,
  sigBase64: string,
  publicKeys: readonly string[],
  keyIdHint: string | undefined,
): boolean {
  const ordered = orderKeysByHint(publicKeys, keyIdHint)
  return ordered.some((publicKeyB64) => verifyWithSingleKey(manifestBytes, sigBase64, publicKeyB64))
}

/** Moves the pinned key whose `keyId` matches `keyIdHint` (if any) to the front; leaves order untouched otherwise. */
function orderKeysByHint(publicKeys: readonly string[], keyIdHint: string | undefined): readonly string[] {
  if (!keyIdHint) return publicKeys
  const matchIndex = publicKeys.findIndex((key) => computeKeyId(key) === keyIdHint)
  if (matchIndex <= 0) return publicKeys
  return [publicKeys[matchIndex], ...publicKeys.slice(0, matchIndex), ...publicKeys.slice(matchIndex + 1)]
}

/** The first 8 bytes (hex) of sha256(raw 32-byte public key) — matches `murasaki release --sign`'s `keyId`. `undefined` for a malformed key rather than throwing, so a bad pinned key just never matches a hint. */
function computeKeyId(publicKeyB64: string): string | undefined {
  try {
    const rawKey = Buffer.from(publicKeyB64.trim(), 'base64')
    if (rawKey.length !== 32) return undefined
    return createHash('sha256').update(rawKey).digest('hex').slice(0, 16)
  } catch {
    return undefined
  }
}

/** Reads a `keyId` hint out of the manifest bytes without trusting them — used only to pick which pinned key `verifyManifestSignature` tries first. */
function peekManifestKeyId(manifestBytes: Buffer): string | undefined {
  try {
    const parsed = JSON.parse(manifestBytes.toString('utf8'))
    return typeof parsed?.keyId === 'string' ? parsed.keyId : undefined
  } catch {
    return undefined
  }
}

/** Wraps the raw 32-byte base64 public key (contract §2) as SPKI DER and verifies a detached Ed25519 signature over the raw manifest bytes against a single key. */
function verifyWithSingleKey(manifestBytes: Buffer, sigBase64: string, publicKeyB64: string): boolean {
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
 * TLS enforcement for a custom `updater.endpoint` (fetch-time half of the
 * defense-in-depth pair — see config.ts's `validateUpdaterConfig`, which
 * rejects this at config-validation time). Duplicated (not imported) because
 * this module compiles to a standalone `updater-engine.mjs` with no
 * non-`node:` imports, copied alone into a packaged app's resources dir (see
 * this file's top doc comment) — it can't reach into config.ts at runtime.
 */
function assertSecureManifestUrl(manifestUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(manifestUrl)
  } catch {
    throw new Error('updater: manifestUrl is not a valid URL')
  }
  if (parsed.protocol === 'https:') return
  if (parsed.protocol === 'http:' && isLoopbackUpdaterHost(parsed.hostname)) return
  throw new Error(
    'updater: manifestUrl must use https: (http: is only allowed for loopback hosts — ' +
      '127.0.0.1, localhost, [::1] — for local testing)',
  )
}

function isLoopbackUpdaterHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/**
 * Anti-freeze/replay guard for the manifest's optional `generatedAt`
 * (written by `murasaki release --manifest`). Absent: accepted for
 * back-compat with manifests published before this field existed, but logs a
 * structured warning. Present: must parse as a real timestamp, must not be
 * older than `maxAgeDays`, and must not be more than `CLOCK_SKEW_TOLERANCE_MS`
 * in the future — both throw, becoming this check()'s `error` state.
 */
function assertManifestFreshness(generatedAt: unknown, maxAgeDays: number): void {
  if (generatedAt === undefined) {
    logUpdaterEvent('warn', 'updater.manifest.generated_at_missing', {})
    return
  }
  if (typeof generatedAt !== 'string') {
    throw new Error('manifest "generatedAt" must be an ISO 8601 timestamp string')
  }
  const generatedMs = Date.parse(generatedAt)
  if (Number.isNaN(generatedMs)) {
    throw new Error(`manifest "generatedAt" (${generatedAt}) is not a valid ISO 8601 timestamp`)
  }
  const ageMs = Date.now() - generatedMs
  if (ageMs > maxAgeDays * MS_PER_DAY) {
    throw new Error(
      `manifest is older than the ${maxAgeDays}-day freshness limit (generatedAt: ${generatedAt}) — ` +
        'refusing a possibly frozen or replayed manifest',
    )
  }
  if (ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
    throw new Error(
      `manifest "generatedAt" (${generatedAt}) is too far in the future — possible clock skew or tampering`,
    )
  }
}

/** Clamps a manifest's optional `rollout` to 0-100; a missing/malformed value means "no restriction" (100). */
function resolveRolloutPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.min(100, Math.max(0, Math.trunc(value)))
}

/** First byte of sha256(clientId) mod 100 — a stable, uniformly-distributed 0-99 bucket for staged rollout. */
function rolloutBucket(clientId: string): number {
  const digest = createHash('sha256').update(clientId).digest()
  return digest[0] % 100
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One-line structured JSON log for non-error updater events (manifest warnings, rollout exclusion) — mirrors `main/logger.ts`'s JSONL shape without depending on it (see this module's no-non-`node:`-imports constraint). */
function logUpdaterEvent(level: 'info' | 'warn', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields })
  if (level === 'warn') console.warn(line)
  else console.log(line)
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

async function fetchLimitedBytes(
  url: string,
  label: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  return withFetchTimeout(label, timeoutMs, async (signal) => {
    const res = await fetch(url, { signal })
    if (!res.ok) {
      throw new Error(`failed to fetch ${label}: HTTP ${res.status}`)
    }
    enforceContentLength(res, label, maxBytes)
    if (!res.body) return Buffer.alloc(0)

    const chunks: Buffer[] = []
    let received = 0
    const stream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += bytes.length
      if (received > maxBytes) {
        throw new Error(`${label} exceeds the ${maxBytes}-byte size limit`)
      }
      chunks.push(bytes)
    }
    return Buffer.concat(chunks, received)
  })
}

/** Streams `url` to `dest`, hashing and enforcing the byte cap without buffering the payload in memory. */
async function streamDownload(
  url: string,
  dest: string,
  maxBytes: number,
  timeoutMs: number,
  onProgress: (progress: number) => void,
): Promise<string> {
  return withFetchTimeout('update payload', timeoutMs, async (signal) => {
    const res = await fetch(url, { signal })
    if (!res.ok || !res.body) {
      throw new Error(`failed to download update: HTTP ${res.status}`)
    }
    const total = enforceContentLength(res, 'update payload', maxBytes)
    let received = 0
    const hash = createHash('sha256')
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > maxBytes) {
          callback(new Error(`update payload exceeds the ${maxBytes}-byte size limit`))
          return
        }
        hash.update(chunk)
        if (total > 0) onProgress(Math.min(received / total, 1))
        callback(null, chunk)
      },
    })
    const source = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
    await pipeline(source, meter, createWriteStream(dest, { flags: 'wx', mode: 0o600 }))
    return hash.digest('hex')
  })
}

function enforceContentLength(res: Response, label: string, maxBytes: number): number {
  const header = res.headers.get('content-length')
  if (header === null) return 0
  const size = Number(header)
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`${label} has an invalid content-length`)
  }
  if (size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte size limit`)
  }
  return size
}

async function withFetchTimeout<T>(
  label: string,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  timer.unref()
  try {
    return await operation(controller.signal)
  } catch (err) {
    if (timedOut) throw new Error(`${label} request timed out after ${timeoutMs}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function writeAtomicPrivateFile(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, path)
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`updater: ${name} must be a positive safe integer`)
  }
  return resolved
}

function basenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const candidate = pathname.split('/').pop() || ''
    if (!candidate || candidate === '.' || candidate === '..') return 'update-payload'
    return candidate.replace(/[^0-9A-Za-z._%+-]/g, '_') || 'update-payload'
  } catch {
    return 'update-payload'
  }
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 80)
  return safe && safe !== '.' && safe !== '..' ? safe : 'unknown'
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
