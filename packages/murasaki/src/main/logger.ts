import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type MainLogLevel = 'debug' | 'info' | 'warn' | 'error'
export interface MainLogFields { [key: string]: unknown }

export interface MainLoggerOptions {
  directory: string
  appId: string
  productName: string
  version: string
  /** Rotates before an append would exceed this size. Default 5 MiB. */
  maxBytes?: number
  /** Number of rotated files retained in addition to the active file. Default 5. */
  maxFiles?: number
  /** Also mirror records to stdout/stderr. Default true. */
  console?: boolean
}

export interface DiagnosticReportOptions {
  /** Include bounded tails of framework log files. Default true. */
  includeLogs?: boolean
  /** Maximum bytes read from each log file. Default 256 KiB. */
  maxLogBytes?: number
  /** App-owned diagnostic state. Secret-looking fields are redacted. */
  extra?: MainLogFields
}

export interface MainLogger {
  readonly path: string
  debug(message: string, fields?: MainLogFields): void
  info(message: string, fields?: MainLogFields): void
  warn(message: string, fields?: MainLogFields): void
  error(message: string, fields?: MainLogFields): void
  flush(): Promise<void>
  createDiagnosticReport(options?: DiagnosticReportOptions): Promise<string>
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_FILES = 5
const DEFAULT_REPORT_LOG_BYTES = 256 * 1024
const MAX_FIELD_DEPTH = 6
const MAX_ARRAY_ITEMS = 100
const MAX_STRING_LENGTH = 8 * 1024
const SECRET_FIELD_RE = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key)/i

/** Create the structured, rotating logger attached to every Node Main context. */
export function createMainLogger(options: MainLoggerOptions): MainLogger {
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes')
  const maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_FILES, 'maxFiles')
  const mirrorConsole = options.console ?? true
  const path = join(options.directory, 'murasaki-main.jsonl')
  let pending: Promise<void> = Promise.resolve()

  const write = (level: MainLogLevel, message: string, fields?: MainLogFields): void => {
    const safeMessage = boundedString(message)
    const safeFields = fields ? sanitize(fields, 0, new WeakSet()) : undefined
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message: safeMessage,
      ...(safeFields ? { fields: safeFields } : {}),
    })}\n`
    pending = pending
      .then(async () => {
        await mkdir(options.directory, { recursive: true })
        await rotateIfNeeded(path, Buffer.byteLength(line), maxBytes, maxFiles)
        await appendFile(path, line, { encoding: 'utf8', mode: 0o600 })
      })
      .catch((error) => {
        console.error(`[murasaki] failed to write main log: ${errorMessage(error)}`)
      })

    if (mirrorConsole) {
      const suffix = safeFields ? ` ${JSON.stringify(safeFields)}` : ''
      const output = `[murasaki:${level}] ${safeMessage}${suffix}`
      if (level === 'error') console.error(output)
      else if (level === 'warn') console.warn(output)
      else console.log(output)
    }
  }

  return {
    path,
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    flush: () => pending,
    async createDiagnosticReport(reportOptions = {}) {
      await pending
      const maxLogBytes = positiveInteger(
        reportOptions.maxLogBytes,
        DEFAULT_REPORT_LOG_BYTES,
        'maxLogBytes',
      )
      const report = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        application: {
          appId: options.appId,
          productName: options.productName,
          version: options.version,
        },
        runtime: {
          platform: process.platform,
          arch: process.arch,
          node: process.versions.node,
        },
        ...(reportOptions.extra
          ? { extra: sanitize(reportOptions.extra, 0, new WeakSet()) }
          : {}),
        ...(reportOptions.includeLogs === false
          ? {}
          : { logs: await readLogTails(path, maxFiles, maxLogBytes) }),
      }
      const reportDirectory = join(options.directory, 'diagnostics')
      await mkdir(reportDirectory, { recursive: true })
      const reportPath = join(reportDirectory, `diagnostics-${safeTimestamp()}.json`)
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      return reportPath
    },
  }
}

async function rotateIfNeeded(
  path: string,
  incomingBytes: number,
  maxBytes: number,
  maxFiles: number,
): Promise<void> {
  const currentSize = await stat(path).then((value) => value.size, () => 0)
  if (currentSize + incomingBytes <= maxBytes) return
  await rm(`${path}.${maxFiles}`, { force: true })
  for (let index = maxFiles - 1; index >= 1; index--) {
    await rename(`${path}.${index}`, `${path}.${index + 1}`).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
  await rename(path, `${path}.1`).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
}

async function readLogTails(
  path: string,
  maxFiles: number,
  maxBytes: number,
): Promise<Array<{ file: string; truncated: boolean; content: string }>> {
  const paths = [path, ...Array.from({ length: maxFiles }, (_, index) => `${path}.${index + 1}`)]
  const logs = []
  for (const candidate of paths) {
    const data = await readFile(candidate).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (!data) continue
    logs.push({
      file: candidate.split(/[\\/]/).at(-1) ?? candidate,
      truncated: data.byteLength > maxBytes,
      content: data.subarray(Math.max(0, data.byteLength - maxBytes)).toString('utf8'),
    })
  }
  return logs
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return boundedString(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return '[undefined]'
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`
  if (value instanceof Error) {
    return {
      name: value.name,
      message: boundedString(value.message),
      stack: value.stack ? boundedString(value.stack) : undefined,
    }
  }
  if (depth >= MAX_FIELD_DEPTH) return '[max-depth]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1, seen))
  }
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SECRET_FIELD_RE.test(key)
      ? '[redacted]'
      : sanitize(entry, depth + 1, seen)
  }
  return output
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}

/** @internal Reused by crash-reports.ts so every capture path bounds strings the same way. */
export function boundedString(value: unknown, maxLength: number = MAX_STRING_LENGTH): string {
  const text = typeof value === 'string' ? value : String(value)
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…[truncated]`
}

/** @internal Reused by crash-reports.ts so crash `extra` fields are redacted the same way as log fields. */
export function redactFields(fields: MainLogFields): MainLogFields {
  return sanitize(fields, 0, new WeakSet()) as MainLogFields
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
