import { resolve, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile, rm, cp, copyFile, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import pc from 'picocolors'
import build from './build.js'
import type { MurasakiConfig } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Pack `dist/client` + a copy of the current Node runtime + the production
 * launcher (`assets/prod-launcher.mjs`) into a macOS `.app` bundle.
 *
 * production has no Vite dev server — `prod-launcher.mjs` runs a small
 * static file server over `dist/client` instead and points the native
 * WebView at it (see assets/prod-launcher.mjs for the dev.ts → prod
 * translation).
 */
export default async function bundle(argv: string[]) {
  const cwd = process.cwd()
  const config = await loadUserConfig(cwd)
  if (!existsSync(resolve(cwd, 'dist/client'))) await build(argv)

  if (process.platform !== 'darwin') {
    process.stdout.write(
      `\n  ${pc.yellow('!')} bundle: only macOS is supported right now.\n\n`,
    )
    return
  }

  const productName = config.productName
  const appDir = resolve(cwd, 'dist/bundle', `${productName}.app`)
  await rm(appDir, { recursive: true, force: true })

  const macosDir = join(appDir, 'Contents/MacOS')
  const resourcesDir = join(appDir, 'Contents/Resources')
  await mkdir(macosDir, { recursive: true })
  await mkdir(resourcesDir, { recursive: true })

  // Contents/MacOS/<productName> — bash launcher that execs the bundled
  // node against the bundled prod-launcher.mjs, both under Resources/.
  const launcher = `#!/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)/Resources"
cd "$DIR"
exec "$DIR/node" "$DIR/prod-launcher.mjs"
`
  await writeFile(join(macosDir, productName), launcher, { mode: 0o755 })

  // Contents/Resources/node — copy of the current node binary. Distributing
  // to other machines needs a downloaded, target-specific node instead
  // (ensureNodeBinary-style fetch); that lands in a later phase. For now we
  // ship whatever node is running this CLI, which is enough to run on this
  // machine.
  const nodeDest = join(resourcesDir, 'node')
  await copyFile(process.execPath, nodeDest)
  await chmod(nodeDest, 0o755)

  // Contents/Resources/prod-launcher.mjs
  const launcherSrc = resolve(__dirname, '../../assets/prod-launcher.mjs')
  await copyFile(launcherSrc, join(resourcesDir, 'prod-launcher.mjs'))

  // Contents/Resources/icon.icns + icon.png — the .icns backs the .app's
  // Finder/DMG appearance (via CFBundleIconFile below); the plain PNG is
  // read at runtime by prod-launcher.mjs to set NSApp.applicationIconImage
  // (see assets/prod-launcher.mjs — needed because the running process is
  // the bundled `node` binary, not a "real" app executable).
  const iconResource = config.icon ? await buildIcon(cwd, config.icon, resourcesDir) : null

  // Contents/Resources/murasaki-meta.json
  await writeFile(
    join(resourcesDir, 'murasaki-meta.json'),
    JSON.stringify(
      {
        appId: config.appId,
        productName,
        version: config.version ?? '0.0.0',
        width: config.window?.width,
        height: config.window?.height,
        vibrancy: config.window?.vibrancy,
        icon: iconResource ?? undefined,
      },
      null,
      2,
    ),
  )

  // Contents/Resources/client — the Vite build output.
  await cp(resolve(cwd, 'dist/client'), join(resourcesDir, 'client'), {
    recursive: true,
  })

  // Contents/Resources/node_modules/@murasakijs/native — external native
  // binding, copied as-is since its .node binary is arch-specific and
  // can't go through esbuild/tsc.
  const nativeSrc = resolveNativeModuleDir(cwd)
  const nativeDest = join(resourcesDir, 'node_modules/@murasakijs/native')
  await mkdir(dirname(nativeDest), { recursive: true })
  await cp(nativeSrc, nativeDest, { recursive: true })

  // Contents/Info.plist
  await writeFile(
    join(appDir, 'Contents/Info.plist'),
    infoPlist(config, productName, iconResource !== null),
  )

  process.stdout.write(`\n  ${pc.green('✓')} bundle written  ${pc.gray(appDir)}\n\n`)
}

function resolveNativeModuleDir(cwd: string): string {
  const req = createRequire(resolve(cwd, 'package.json'))
  const pkgJson = req.resolve('@murasakijs/native/package.json')
  return dirname(pkgJson)
}

/**
 * `config.icon` (a 1024px PNG) → `<resourcesDir>/icon.icns` + `icon.png`.
 * Same sips/iconutil technique as `murasaki icon` (cli/icon.ts), fanned out
 * to the full standard iconset (base + @2x) so iconutil doesn't silently
 * drop entries. Returns the meta.json-relative icon path ("icon.png"), or
 * `null` if `iconPath` doesn't resolve to a file.
 */
async function buildIcon(
  cwd: string,
  iconPath: string,
  resourcesDir: string,
): Promise<string | null> {
  const src = resolve(cwd, iconPath)
  if (!existsSync(src)) {
    process.stdout.write(`\n  ${pc.yellow('!')} icon: ${iconPath} not found, skipping\n\n`)
    return null
  }

  // iconutil requires the source directory itself to end in `.iconset`.
  const tmpRoot = await mkdtemp(join(tmpdir(), 'murasaki-icon-'))
  const iset = join(tmpRoot, 'icon.iconset')
  await mkdir(iset)
  try {
    const entries: Array<[name: string, size: number]> = [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024],
    ]
    for (const [name, size] of entries) {
      spawnSync('sips', ['-z', String(size), String(size), src, '--out', join(iset, name)], {
        stdio: 'inherit',
      })
    }
    spawnSync('iconutil', ['-c', 'icns', iset, '-o', join(resourcesDir, 'icon.icns')], {
      stdio: 'inherit',
    })
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }

  // Runtime icon (NSApp.applicationIconImage, set by prod-launcher.mjs) —
  // plain PNG, no conversion needed.
  await copyFile(src, join(resourcesDir, 'icon.png'))

  return 'icon.png'
}

function infoPlist(config: MurasakiConfig, productName: string, hasIcon: boolean): string {
  const appId = escapeXml(config.appId)
  const name = escapeXml(productName)
  const version = escapeXml(config.version ?? '0.0.0')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleExecutable</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>${appId}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>${hasIcon ? '\n  <key>CFBundleIconFile</key><string>icon</string>' : ''}
</dict>
</plist>
`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function loadUserConfig(cwd: string): Promise<MurasakiConfig> {
  for (const name of ['murasaki.config.ts', 'murasaki.config.js', 'murasaki.config.mjs']) {
    const p = resolve(cwd, name)
    try {
      const mod = await import(pathToFileURL(p).href)
      const cfg = mod.default ?? mod.config ?? mod
      if (cfg && typeof cfg === 'object') return cfg
    } catch (err: any) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err
    }
  }
  throw new Error('murasaki: no config found — create murasaki.config.ts')
}
