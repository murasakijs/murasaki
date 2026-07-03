#!/usr/bin/env node
// murasaki dev server — runs Vite's dev server via its JS API in this child
// process (see src/cli/dev.ts for why Vite has to live in its own process)
// and prints a murasaki-branded banner instead of Vite's own CLI output.
//
// Palette/formatting is inlined (not imported from ../dist/cli/brand.js) so
// this file keeps working standalone once murasaki is installed in a user
// project — see src/cli/brand.ts for the TS-side counterpart used in-process
// by `murasaki build`/`bundle`/`installer`.
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── ANSI truecolor (Oomurasaki palette) — kept in sync with src/cli/brand.ts.
const BRIGHT = '\x1b[38;2;168;85;247m'
const DIM = '\x1b[38;2;136;136;153m'
const GREEN = '\x1b[38;2;76;175;80m'
const YELLOW = '\x1b[38;2;234;179;8m'
const RED = '\x1b[38;2;239;68;68m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const noColor = !!process.env.NO_COLOR || !process.stdout.isTTY
const c = (code) => (noColor ? '' : code)
const paint = (text, color, bold) => (bold ? c(BOLD) : '') + c(color) + text + c(RESET)

function parsePort() {
  const args = process.argv.slice(2)
  const idx = args.indexOf('--port')
  if (idx !== -1 && args[idx + 1]) return Number(args[idx + 1])
  if (process.env.MURASAKI_DEV_PORT) return Number(process.env.MURASAKI_DEV_PORT)
  return 5178
}

function readVersion() {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'))
  return pkg.version
}

function warnLine(msg) {
  return `  ${paint('!', YELLOW)} ${msg}`
}

function errorLine(msg) {
  return `  ${paint('✗', RED)} ${msg}`
}

// Vite `Logger` — suppresses Vite's own "VITE vX ready" info banner (murasaki
// prints its own below) while still surfacing real warnings/errors, branded.
let warned = false
const logger = {
  info() {},
  warn(msg) {
    warned = true
    process.stdout.write(`${warnLine(msg)}\n`)
  },
  warnOnce(msg) {
    warned = true
    process.stdout.write(`${warnLine(msg)}\n`)
  },
  error(msg, options) {
    process.stderr.write(`${errorLine(msg)}\n`)
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

async function main() {
  const port = parsePort()
  const cwd = process.cwd()
  const start = performance.now()

  // `root: cwd` lets Vite resolve the project's own vite.config.ts (which
  // wires up murasaki/vite-plugin) — no plugins are hard-coded here.
  const server = await createServer({
    root: cwd,
    server: { port, strictPort: true },
    customLogger: logger,
  })
  await server.listen()

  const actualPort = server.config.server.port ?? port
  const url = `http://localhost:${actualPort}/`
  const ms = Math.round(performance.now() - start)
  const version = readVersion()

  process.stdout.write(
    `\n  ${paint('🦋', BRIGHT)}  ${paint(`murasaki v${version}`, BRIGHT, true)}  ${paint('dev', DIM)}\n` +
      `  ${paint('Local:', DIM)}   ${url}\n\n` +
      `  ${paint('✓', GREEN)} ready in ${ms}ms\n\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`\n${errorLine(err?.message ?? String(err))}\n`)
  if (err?.stack) process.stderr.write(`${err.stack}\n`)
  process.exit(1)
})
