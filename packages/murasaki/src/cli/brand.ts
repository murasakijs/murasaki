import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Logger } from 'vite'

/**
 * Shared branding for all `murasaki` CLI commands — dev, build, bundle,
 * installer. Keeps a single purple palette and a single set of glyphs so
 * every command looks like one product, the way `create-murasaki` already
 * does for scaffolding output (same truecolor palette — see
 * packages/create-murasaki/index.mjs).
 */

// ── ANSI truecolor (Oomurasaki palette) ────────────────────────────────
const BRIGHT = '\x1b[38;2;168;85;247m'
const DIM = '\x1b[38;2;136;136;153m'
const GREEN = '\x1b[38;2;76;175;80m'
const YELLOW = '\x1b[38;2;234;179;8m'
const RED = '\x1b[38;2;239;68;68m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const noColor = !!process.env.NO_COLOR || !process.stdout.isTTY
const c = (code: string) => (noColor ? '' : code)

export const BUTTERFLY = '🦋'

export function paint(text: string, color: string, opts: { bold?: boolean } = {}): string {
  return (opts.bold ? c(BOLD) : '') + c(color) + text + c(RESET)
}

export const dim = (text: string): string => paint(text, DIM)
export const bold = (text: string): string => paint(text, BRIGHT, { bold: true })

let cachedVersion: string | undefined

/** murasaki's own version, read from its package.json (resolved relative to this module). */
export function murasakiVersion(): string {
  if (cachedVersion) return cachedVersion
  const here = dirname(fileURLToPath(import.meta.url))
  const pkg = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8'))
  cachedVersion = pkg.version as string
  return cachedVersion
}

/** Compact Next.js-style header: butterfly mark, version, mode, and (if given) the local URL. */
export function banner(opts: { mode: string; url?: string; version?: string }): string {
  const version = opts.version ?? murasakiVersion()
  const lines = [
    `  ${paint(BUTTERFLY, BRIGHT)}  ${bold(`murasaki v${version}`)}  ${dim(opts.mode)}`,
  ]
  if (opts.url) lines.push(`  ${dim('Local:')}   ${opts.url}`)
  return lines.join('\n')
}

export function success(msg: string): string {
  return `  ${paint('✓', GREEN)} ${msg}`
}

/** e.g. `  ✓ ready in 128ms` */
export function ready(ms: number): string {
  return success(`ready in ${Math.round(ms)}ms`)
}

export function event(label: string, msg: string): string {
  return `  ${paint(label, DIM)} ${msg}`
}

export function info(msg: string): string {
  return `  ${msg}`
}

export function warn(msg: string): string {
  return `  ${paint('!', YELLOW)} ${msg}`
}

export function error(msg: string): string {
  return `  ${paint('✗', RED)} ${msg}`
}

/**
 * A Vite `Logger` that suppresses Vite's own info banner (murasaki prints its
 * own) while still surfacing real warnings and errors, branded through the
 * helpers above. Used with `logLevel: 'silent'` so nothing slips through the
 * default logger either.
 */
export function viteLogger(): Logger {
  let warned = false
  return {
    info() {},
    warn(msg) {
      warned = true
      process.stdout.write(`${warn(msg)}\n`)
    },
    warnOnce(msg) {
      warned = true
      process.stdout.write(`${warn(msg)}\n`)
    },
    error(msg, options) {
      process.stderr.write(`${error(msg)}\n`)
      if (options?.error?.stack) process.stderr.write(`${options.error.stack}\n`)
    },
    clearScreen() {},
    hasErrorLogged() {
      return false
    },
    get hasWarned() {
      return warned
    },
  }
}
