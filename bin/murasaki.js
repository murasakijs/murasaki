#!/usr/bin/env node
// Murasaki CLI entry point.

import 'tsx/esm' // Register the TS+JSX ESM loader (for the user's src/)
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cmd = process.argv[2]

async function loadModule(name) {
  const distPath = resolve(__dirname, '..', 'dist', name + '.js')
  const srcPath = resolve(__dirname, '..', 'src', name + '.tsx')
  const srcAlt = resolve(__dirname, '..', 'src', name + '.ts')
  const target = existsSync(distPath) ? distPath : existsSync(srcPath) ? srcPath : srcAlt
  return import(pathToFileURL(target).href)
}

function flagValue(name) {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1]
  }
  return undefined
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'))
    return pkg.version
  } catch {
    return '0.0.0'
  }
}

const BRIGHT = '\x1b[38;2;168;85;247m'
const DIM = '\x1b[38;2;136;136;153m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const useColor = !process.env.NO_COLOR && process.stdout.isTTY
const c = (code, s) => (useColor ? `${code}${s}${RESET}` : s)
const b = (s) => c(BOLD, s)
const dim = (s) => c(DIM, s)
const purple = (s) => c(BRIGHT, s)

function printHelp(topic) {
  if (topic === 'dev') {
    process.stdout.write(`
${b(purple('murasaki dev'))}   ${dim('— development server (HMR)')}

  Watches src/ for changes, reloads the WebView on save, keeps the
  native menu bar working. Uses tsx to run .tsx source files directly
  from disk — no compile step needed.

  Environment variables:
    ${b('MURASAKI_DEV')}=1              set automatically when this command runs
    ${b('MURASAKI_PROBE')}=1            log document state via evaluateScript (debug)
    ${b('MURASAKI_DUMP_HTML')}=<path>   dump the rendered HTML to <path>

`)
    return
  }
  if (topic === 'build') {
    process.stdout.write(`
${b(purple('murasaki build'))}   ${dim('— production JS bundle')}

  Runs esbuild over the runtime + user src/ and writes a single
  CommonJS bundle to ${b('dist/server.cjs')}. Ships without any packaging
  layer — you can run it directly with ${b('node dist/server.cjs')}.

  Flags:
    ${b('--target <id>')}    darwin-arm64 | darwin-x64 |
                     win-x64 | win-arm64 |
                     linux-x64 | linux-arm64

`)
    return
  }
  if (topic === 'bundle') {
    process.stdout.write(`
${b(purple('murasaki bundle'))}   ${dim('— native folder / .app for the target')}

  Wraps ${b('dist/server.cjs')} in an OS-appropriate container:
    darwin  → ${b('dist/<App>.app')}
    win32   → ${b('dist/<app>/<app>.bat')}   ${dim('(+ .vbs silent launcher)')}
    linux   → ${b('dist/<app>/<app>.sh')}

  Flags:
    ${b('--target <id>')}    cross-compile — see \`murasaki help build\`
    ${b('--slim')}           ship a ~500 KB launcher instead of bundling the
                     Node runtime (${dim('~30 MB downloaded on first launch')})

  Examples:
    murasaki bundle
    murasaki bundle --target win-x64
    murasaki bundle --slim

`)
    return
  }
  if (topic === 'installer') {
    process.stdout.write(`
${b(purple('murasaki installer'))}   ${dim('— distributable archive / disk image')}

  Wraps the bundle output in a per-OS installer:
    darwin  → ${b('dist/<App>-<ver>.dmg')}         ${dim('(drag-to-install layout)')}
    win32   → ${b('dist/<app>-<ver>.msi')}         ${dim('(WiX v4 if available)')}
              ${b('dist/<app>-<ver>.zip')}         ${dim('(fallback)')}
    linux   → ${b('dist/<app>-<ver>-<arch>.AppImage')} ${dim('(mksquashfs)')}
              ${b('dist/<app>-<ver>.tar.gz')}      ${dim('(fallback)')}

  Host tool requirements:
    ${b('.dmg')}      macOS host only (uses hdiutil)
    ${b('.msi')}      any host + WiX v4 (${dim('dotnet tool install -g wix')})
    ${b('.AppImage')} any host + squashfs (${dim('brew install squashfs / apt install squashfs-tools')})
    ${b('.zip')}      any host, built-in
    ${b('.tar.gz')}   any host, built-in

  Flags:
    ${b('--target <id>')}    cross-compile — see \`murasaki help build\`
    ${b('--slim')}           launcher-only mode — see \`murasaki help bundle\`

  Examples:
    murasaki installer
    murasaki installer --target win-x64
    murasaki installer --target linux-arm64

`)
    return
  }
  // Top-level help
  process.stdout.write(`
  ${b(purple('🦋 murasaki'))} ${dim('v' + readVersion())}   ${dim('— desktop apps for Next.js developers')}

  ${b('Usage:')}  murasaki <command> [options]

  ${b('Commands:')}
    ${b('dev')}                Start the development server (HMR)
    ${b('build')}              Production JS bundle → dist/server.cjs
    ${b('bundle')}             Native folder / .app for the target
    ${b('installer')}          Distributable archive / installer for the target
    ${b('help')} [command]     Show detailed help for a command

  ${b('Common flags:')}
    ${b('--target <id>')}      Cross-compile for a specific platform
                       darwin-arm64 | darwin-x64 |
                       win-x64 | win-arm64 |
                       linux-x64 | linux-arm64
    ${b('--slim')}             (bundle/installer) ship a launcher only,
                       download Node runtime at first launch (~500 KB)
    ${b('-h, --help')}         Show this help
    ${b('-v, --version')}      Print the murasaki version

  ${b('Examples:')}
    murasaki dev
    murasaki bundle --target win-x64
    murasaki installer --slim
    murasaki help installer

  ${dim('Docs:  https://github.com/murasakijs/murasaki')}

`)
}

const helpAliases = new Set(['help', '--help', '-h'])
const versionAliases = new Set(['--version', '-v'])

if (cmd === 'dev') {
  process.env.MURASAKI_DEV = '1'
  await loadModule('dev')
} else if (cmd === 'build') {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp('build')
  } else {
    const mod = await loadModule('build')
    await mod.build({ target: flagValue('target') })
  }
} else if (cmd === 'bundle') {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp('bundle')
  } else {
    const mod = await loadModule('build')
    await mod.build({
      pack: true,
      target: flagValue('target'),
      slim: process.argv.includes('--slim'),
    })
  }
} else if (cmd === 'installer') {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp('installer')
  } else {
    const mod = await loadModule('build')
    await mod.build({
      pack: true,
      installer: true,
      target: flagValue('target'),
      slim: process.argv.includes('--slim'),
    })
  }
} else if (helpAliases.has(cmd)) {
  const topic = process.argv[3]
  printHelp(topic)
} else if (versionAliases.has(cmd)) {
  process.stdout.write(readVersion() + '\n')
} else if (!cmd) {
  printHelp()
} else {
  process.stderr.write(`\n  ${useColor ? '\x1b[38;2;239;68;68m' : ''}unknown command: ${cmd}${useColor ? RESET : ''}\n`)
  process.stderr.write(`  ${dim('run')} ${b('murasaki help')} ${dim('for the full list')}\n\n`)
  process.exit(1)
}
