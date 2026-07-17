import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { boundedString, redactFields } from './logger.js'

/**
 * Local, versioned crash report capture — Phase 1 of desktop diagnostics.
 * Shared by three writers: `main-runtime.ts`'s `uncaughtException`/
 * `unhandledRejection` hooks (domain `node`), `assets/prod-server.mjs`'s
 * renderer error endpoint (domain `renderer`), and
 * `crates/native/src/launcher.rs`'s panic hook / unexpected-Node-exit path
 * (domain `native`, written directly by Rust using the same directory and
 * filename convention — see that file's `write_native_crash_report`).
 *
 * Murasaki never transmits these anywhere: this module only captures and
 * exposes them through `MainContext.diagnostics`. Reused from
 * `assets/prod-server.mjs` via the same `.murasaki-runtime/main/` copy that
 * already ships `logger.js`/`sidecar.js` (see `cli/bundle.ts`'s
 * `copyMainRuntime`), so keep this file free of anything beyond `./logger.js`
 * and Node builtins.
 */

export const CRASH_REPORT_VERSION = 1

export type CrashReportDomain = 'node' | 'native' | 'renderer'

/** One versioned local crash report. */
export interface CrashReport {
  reportVersion: 1
  domain: CrashReportDomain
  timestamp: string
  appVersion: string
  frameworkVersion: string
  os: string
  arch: string
  message: string
  stack?: string
  extra?: Record<string, unknown>
}

/** Metadata-only projection returned by `listCrashReports()`. */
export interface CrashReportSummary {
  id: string
  domain: CrashReportDomain
  timestamp: string
  appVersion: string
}

/** Read/write surface exposed on `MainContext.diagnostics`. */
export interface CrashDiagnosticsApi {
  listCrashReports(): Promise<CrashReportSummary[]>
  readCrashReport(id: string): Promise<CrashReport | null>
  clearCrashReports(): Promise<void>
}

export interface CrashReportInput {
  domain: CrashReportDomain
  message: string
  stack?: string
  extra?: Record<string, unknown>
  appVersion: string
  frameworkVersion: string
}

const MAX_MESSAGE_LENGTH = 8 * 1024
const MAX_STACK_LENGTH = 32 * 1024
const MAX_VERSION_LENGTH = 256
export const DEFAULT_KEEP_CRASH_REPORTS = 20

// Filenames are `<safe-ISO-timestamp>-<domain>.json`, written by both this
// module and the native launcher into the same directory. This charset
// allowlist is the only thing standing between a caller-supplied `id`
// (`readCrashReport`) and a path-traversal read: no `/`, `\`, or leading
// `.`, so `join(directory, id)` can never leave `directory`.
const CRASH_REPORT_ID_RE = /^[0-9A-Za-z][0-9A-Za-z_.-]{0,180}\.json$/

/** @internal Exported for tests; also usable by app code validating a stored id. */
export function isValidCrashReportId(id: unknown): id is string {
  return typeof id === 'string' && CRASH_REPORT_ID_RE.test(id)
}

function safeTimestampComponent(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-')
}

function buildReport(input: CrashReportInput): CrashReport {
  return {
    reportVersion: CRASH_REPORT_VERSION,
    domain: input.domain,
    timestamp: new Date().toISOString(),
    appVersion: boundedString(input.appVersion, MAX_VERSION_LENGTH),
    frameworkVersion: boundedString(input.frameworkVersion, MAX_VERSION_LENGTH),
    os: process.platform,
    arch: process.arch,
    message: boundedString(input.message, MAX_MESSAGE_LENGTH),
    ...(input.stack !== undefined ? { stack: boundedString(input.stack, MAX_STACK_LENGTH) } : {}),
    ...(input.extra !== undefined ? { extra: redactFields(input.extra) as Record<string, unknown> } : {}),
  }
}

/**
 * Writes one crash report synchronously and atomically (temp file + rename)
 * so a caller about to end the process (`process.exit()`) cannot race past an
 * in-flight async write. Directory creation, the write, and rotation are all
 * best-effort: a failure here must never throw back into a crash path.
 */
export function writeCrashReportSync(
  directory: string,
  input: CrashReportInput,
  keepReports: number = DEFAULT_KEEP_CRASH_REPORTS,
): string | null {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const report = buildReport(input)
    const filename = `${safeTimestampComponent(report.timestamp)}-${report.domain}.json`
    const finalPath = join(directory, filename)
    const tempPath = join(directory, `.${filename}.tmp-${process.pid}`)
    writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(tempPath, finalPath)
    rotateCrashReportsSync(directory, keepReports)
    return filename
  } catch {
    return null
  }
}

function listReportFilenamesSync(directory: string): string[] {
  try {
    return readdirSync(directory).filter((name) => CRASH_REPORT_ID_RE.test(name)).sort()
  } catch {
    return []
  }
}

/** Keeps the newest `keepReports` files (by sorted, timestamp-prefixed name) and deletes the rest. */
function rotateCrashReportsSync(directory: string, keepReports: number): void {
  const files = listReportFilenamesSync(directory)
  const keep = Math.max(1, keepReports)
  const excess = files.length - keep
  if (excess <= 0) return
  for (const file of files.slice(0, excess)) {
    try {
      rmSync(join(directory, file), { force: true })
    } catch {
      // best-effort: a stuck rotation must not block crash capture
    }
  }
}

async function readReportFile(directory: string, filename: string): Promise<CrashReport | null> {
  try {
    const raw = await readFile(join(directory, filename), 'utf8')
    const parsed = JSON.parse(raw) as Partial<CrashReport> | null
    if (!parsed || typeof parsed !== 'object' || parsed.reportVersion !== CRASH_REPORT_VERSION) return null
    return parsed as CrashReport
  } catch {
    return null
  }
}

/** Builds the read/write API exposed on `MainContext.diagnostics`. */
export function createCrashDiagnostics(directory: string): CrashDiagnosticsApi {
  return {
    async listCrashReports() {
      let files: string[]
      try {
        files = (await readdir(directory)).filter((name) => CRASH_REPORT_ID_RE.test(name)).sort()
      } catch {
        return []
      }
      const summaries: CrashReportSummary[] = []
      for (const file of files) {
        const report = await readReportFile(directory, file)
        if (!report) continue
        summaries.push({
          id: file,
          domain: report.domain,
          timestamp: report.timestamp,
          appVersion: report.appVersion,
        })
      }
      return summaries
    },
    async readCrashReport(id) {
      if (!isValidCrashReportId(id)) return null
      return readReportFile(directory, id)
    },
    async clearCrashReports() {
      let files: string[]
      try {
        files = await readdir(directory)
      } catch {
        return
      }
      await Promise.all(
        files
          .filter((name) => CRASH_REPORT_ID_RE.test(name))
          .map((name) => rm(join(directory, name), { force: true }).catch(() => {})),
      )
    },
  }
}
