#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cmd = process.argv[2]

const distEntry = resolve(__dirname, '..', 'dist', 'cli', `${cmd || 'help'}.js`)
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  const banner = readVersionBanner()
  process.stdout.write(banner)
  process.exit(cmd ? 0 : 0)
}

if (cmd === '--version' || cmd === '-v') {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'))
  process.stdout.write(pkg.version + '\n')
  process.exit(0)
}

if (!existsSync(distEntry)) {
  process.stderr.write(`\n  unknown command: ${cmd}\n  run 'murasaki help' for the list\n\n`)
  process.exit(1)
}

const mod = await import(pathToFileURL(distEntry).href)
if (typeof mod.default !== 'function') {
  process.stderr.write(`\n  internal: ${cmd}.js has no default export\n\n`)
  process.exit(1)
}
await mod.default(process.argv.slice(3))

function readVersionBanner() {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'))
  return `\n  🦋 murasaki v${pkg.version}   desktop apps with Next.js DX\n\n  Usage:  murasaki <command> [options]\n\n  Commands:\n    dev          Start the Vite dev server + native WebView\n    build        Vite production build\n    bundle       Native folder / .app for the current platform\n    installer    Distributable installer (.dmg / .msi / .AppImage / .zip)\n    init         Install Rust toolchain for native binding hackers\n    icon         Generate .icns / .ico / .png set from a PNG\n    release      Auto-update manifest helpers\n    help         Show this help\n\n  Flags:\n    --target <id>   cross-compile (darwin-arm64 | darwin-x64 | win32-x64 | ...)\n    --version       print version\n\n  Docs: https://murasaki.dev\n\n`
}
