#!/usr/bin/env node
// Murasaki CLI entry point.

import 'tsx/esm' // Register the TS+JSX ESM loader (for the user's src/)
import { existsSync } from 'node:fs'
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

if (cmd === 'dev') {
  process.env.MURASAKI_DEV = '1'
  await loadModule('dev')
} else if (cmd === 'build') {
  const mod = await loadModule('build')
  await mod.build({ target: flagValue('target') })
} else if (cmd === 'bundle') {
  const mod = await loadModule('build')
  await mod.build({
    pack: true,
    target: flagValue('target'),
    slim: process.argv.includes('--slim'),
  })
} else if (cmd === 'installer') {
  const mod = await loadModule('build')
  await mod.build({
    pack: true,
    installer: true,
    target: flagValue('target'),
    slim: process.argv.includes('--slim'),
  })
} else {
  process.stdout.write(`
Usage:
  murasaki dev                       Start the development server (HMR)
  murasaki build                     Production JS bundle  -> dist/server.cjs
  murasaki bundle                    Native folder / .app for the target:
                                       darwin -> dist/<App>.app
                                       win32  -> dist/<app>/<app>.bat (+ .vbs silent)
                                       linux  -> dist/<app>/<app>.sh
  murasaki installer                 Distributable archive for the target:
                                       darwin -> dist/<App>-<ver>.dmg
                                       win32  -> dist/<app>-<ver>.zip
                                       linux  -> dist/<app>-<ver>.tar.gz

Cross-compile flag (available on all build/bundle/installer commands):
  --target <id>                      darwin-arm64 | darwin-x64 |
                                     win-x64 | win-arm64 |
                                     linux-x64 | linux-arm64

  Examples:
    murasaki bundle --target win-x64
    murasaki installer --target linux-arm64

Host requirements for installer formats:
    .dmg  → only on macOS host (uses hdiutil)
    .msi  → any host + WiX v4 (dotnet tool install -g wix)
    .AppImage → any host + squashfs-tools
    .zip  → cross-platform (zip/Compress-Archive)
    .tar.gz → cross-platform

Size reduction:
  --slim                             Ship a ~5 MB launcher instead of bundling
                                     Node runtime (~90 MB). The Node runtime
                                     is downloaded to
                                     ~/.murasaki/runtime/<bundleId>/ on first
                                     launch, with a native confirm dialog.
                                     (Currently macOS-only; Windows/Linux
                                     fall back to the bundled runtime.)

  Examples:
    murasaki bundle    --slim
    murasaki installer --slim

`)
  process.exit(cmd ? 1 : 0)
}
