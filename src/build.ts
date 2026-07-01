// `murasaki build [--pack]` — production build pipeline.
//
// Stages:
//   1. esbuild bundles user pages + the murasaki runtime into dist/server.cjs
//   2. --pack → ship-ready distributable for the current OS:
//        - darwin → dist/<App>.app  (Electron-style: Resources/{node, server.cjs, node_modules})
//        - win32  → dist/<app>/      (folder: node.exe + server.cjs + launcher.bat + node_modules)
//        - linux  → dist/<app>/      (folder: node + server.cjs + launcher.sh + node_modules)
//
// Cross-compilation (build a Windows .exe from macOS, etc.) is a follow-up:
// it requires downloading the foreign Node binary + a foreign-arch
// @webviewjs/webview prebuild. For now, build on the same OS you ship for.

import { spawn } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, resolveAppMeta } from './config.ts'
import { currentTarget, ensureNodeBinary, ensureWebviewPrebuild, type Target, TARGETS } from './download.ts'
import { APP_DIR, APP_GLOBALS_CSS, projectRoot } from './env.ts'
import { discoverRoutes, type Route } from './runtime/routes.ts'
import { detectMksquashfs, makeAppImage } from './appimage.ts'
import { detectWix, makeMsi } from './wix.ts'

/**
 * Node runtime version murasaki pins by default. `--slim` bundles download
 * exactly this version at first launch; regular bundles ship it inline.
 * Users can override with `runtime: { node: 'v22.x.x' }` in murasaki.config.ts.
 */
const DEFAULT_NODE_VERSION = `v${process.versions.node}`

const out = (s: string) => process.stdout.write(s)
const RESET = '\x1b[0m'
const DIM = '\x1b[38;2;136;136;153m'
const GREEN = '\x1b[38;2;76;175;80m'
const RED = '\x1b[38;2;239;68;68m'
const BOLD = '\x1b[1m'
const BRIGHT = '\x1b[38;2;168;85;247m'
const noColor = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY
const dim = (s: string) => (noColor ? s : DIM + s + RESET)
const green = (s: string) => (noColor ? s : GREEN + s + RESET)
const red = (s: string) => (noColor ? s : RED + s + RESET)
const bold = (s: string) => (noColor ? s : BOLD + s + RESET)
const bright = (s: string) => (noColor ? s : BRIGHT + s + RESET)

type BuildOptions = {
  /** Produce a native distributable folder/.app. */
  pack?: boolean
  /** Wrap the --pack output in a per-OS installer/archive. Implies --pack. */
  installer?: boolean
  /** Target platform id (e.g. "win-x64"). Defaults to the current host. */
  target?: Target['id']
  /**
   * Ship a launcher-only package that downloads Node runtime on first
   * launch instead of bundling it. ~5 MB instead of ~40 MB.
   */
  slim?: boolean
}

export async function build(opts: BuildOptions = {}): Promise<void> {
  if (opts.installer) opts.pack = true
  const startAt = Date.now()
  const distDir = join(projectRoot, 'dist')
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

  const target = opts.target ? TARGETS[opts.target] : currentTarget()
  const isCross = target.id !== currentTarget().id

  out(`\n   ${bold(bright('🦋 Murasaki'))} — production build\n\n`)
  out(`   ${dim('Project ')}${projectRoot}\n`)
  out(`   ${dim('Target  ')}${target.id}${isCross ? dim(' (cross-compiled)') : ''}\n`)
  out(`   ${dim('Out     ')}${distDir}/\n\n`)

  const serverPath = await bundleServer(distDir)

  let packPath: string | null = null
  if (opts.pack) {
    const packOpts = { slim: opts.slim ?? false }
    if (target.os === 'darwin') packPath = await packMacApp(distDir, serverPath, target, packOpts)
    else if (target.os === 'win32') packPath = await packWindows(distDir, serverPath, target, packOpts)
    else packPath = await packLinux(distDir, serverPath, target, packOpts)
  }

  let installerPath: string | null = null
  if (opts.installer && packPath) {
    if (target.os === 'darwin') {
      if (process.platform !== 'darwin') {
        out(`   ${red('!')} .dmg requires hdiutil (macOS host) — skipping installer step\n`)
      } else {
        installerPath = await makeDmg(distDir, packPath)
      }
    } else if (target.os === 'win32') {
      // Try .msi via WiX v4 first; fall back to .zip if wix isn't on PATH.
      const meta2 = await resolveAppMeta()
      const appName2 = readAppName()
      if (detectWix()) {
        out(`   ${dim('3.')} packaging windows ${bold(appName2 + '.msi')} ${dim('(via WiX v4)')}\n`)
        try {
          installerPath = await makeMsi({
            distDir,
            folderPath: packPath,
            appName: appName2,
            displayName: meta2.name ?? capitalize(appName2),
            version: meta2.version,
            manufacturer: meta2.copyright?.replace(/^©\s*\d+\s+/, '') ?? meta2.name ?? appName2,
            bundleId: meta2.bundleId,
          })
          out(`     ${green('✓')} ${dim('built')} ${installerPath}\n`)
        } catch (e) {
          out(`     ${red('✗')} wix build failed: ${(e as Error).message} — falling back to .zip\n`)
          installerPath = null
        }
      }
      if (!installerPath) {
        if (!detectWix()) {
          out(
            `   ${dim('!')} ${dim('wix not found — falling back to .zip. Install with:')}\n` +
              `      ${dim('dotnet tool install -g wix')}\n`,
          )
        }
        installerPath = await makeZipCross(distDir, packPath)
      }
    } else {
      // Linux: try .AppImage via mksquashfs first; fall back to .tar.gz.
      const meta3 = await resolveAppMeta()
      const appName3 = readAppName()
      if (detectMksquashfs()) {
        out(`   ${dim('3.')} packaging linux ${bold(appName3 + '.AppImage')} ${dim('(via mksquashfs)')}\n`)
        try {
          installerPath = await makeAppImage({
            distDir,
            folderPath: packPath,
            appName: appName3,
            displayName: meta3.name ?? capitalize(appName3),
            version: meta3.version,
            arch: target.arch,
            iconPath: meta3.icon ? join(projectRoot, meta3.icon) : undefined,
          })
          if (installerPath) {
            out(`     ${green('✓')} ${dim('built')} ${installerPath}\n`)
          }
        } catch (e) {
          out(`     ${red('✗')} appimage build failed: ${(e as Error).message} — falling back to .tar.gz\n`)
          installerPath = null
        }
      }
      if (!installerPath) {
        if (!detectMksquashfs()) {
          out(
            `   ${dim('!')} ${dim('mksquashfs not found — falling back to .tar.gz. Install with:')}\n` +
              `      ${dim('macOS: brew install squashfs')}\n` +
              `      ${dim('Linux: apt install squashfs-tools  (or dnf install squashfs-tools)')}\n`,
          )
        }
        installerPath = await makeTarGz(distDir, packPath)
      }
    }
  }

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1)
  out(`\n   ${green('✓')} done ${dim(`(${elapsed}s)`)}\n\n`)
  out(`   ${dim('Run:')} ${bold('node ' + serverPath)}\n`)
  if (packPath) {
    if (process.platform === 'darwin') out(`   ${dim('     ')}${bold('open ' + packPath)}\n`)
    else if (process.platform === 'win32')
      out(`   ${dim('     ')}${bold(join(packPath, readAppName() + '.bat'))}\n`)
    else out(`   ${dim('     ')}${bold(join(packPath, readAppName() + '.sh'))}\n`)
  }
  if (installerPath) out(`   ${dim('Ship:')} ${bold(installerPath)}\n`)
  out('\n')
}

// ── stage 1: server bundle ─────────────────────────────────────────
async function bundleServer(distDir: string): Promise<string> {
  const esbuild = await import('esbuild')

  // Locate murasaki/dist/prod.js.
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'prod.js'),
    join(here, '../dist/prod.js'),
    join(projectRoot, 'node_modules/murasaki/dist/prod.js'),
  ]
  const prodEntry = candidates.find((p) => existsSync(p))
  if (!prodEntry) {
    out(`   ${red('✗')} could not locate murasaki/dist/prod.js\n`)
    process.exit(1)
  }
  const staticRoutesPath =
    candidates
      .map((p) => p.replace(/prod\.js$/, 'runtime/static-routes.js'))
      .find((p) => existsSync(p)) ?? ''

  const routes = existsSync(APP_DIR) ? discoverRoutes(APP_DIR) : []
  const hasRoutes = routes.length > 0 && Boolean(staticRoutesPath)

  out(`   ${dim('1.')} bundling server (esbuild)\n`)
  out(`     ${dim('entry  ')}${prodEntry}\n`)
  if (hasRoutes) {
    out(`     ${dim('routes ')}${routes.length} page${routes.length === 1 ? '' : 's'}\n`)
  }

  // Pre-build the client-side hydration bundle from user source. Doing
  // this here — while the source files are still on disk — is what makes
  // installed .apps hydrate at all: their filesystem does not contain
  // src/app/**, so runtime esbuild bundling would fail.
  let clientBundleCode = ''
  if (hasRoutes) {
    const rootLayoutFileForClient =
      routes[0]?.layoutFiles.find((p) => p.endsWith('/app/layout.tsx')) ?? null
    try {
      const { bundleClient } = await import('./runtime/bundle.ts')
      clientBundleCode = await bundleClient({
        routes,
        rootLayoutFile: rootLayoutFileForClient,
      })
      out(`     ${green('✓')} ${dim('client bundle')} ${dim(`(${(clientBundleCode.length / 1024).toFixed(1)} KB)`)}\n`)
    } catch (e) {
      out(`     ${red('!')} client bundle failed: ${(e as Error).message}\n`)
      out(`     ${dim('  interactive components (Tabs, Sidebar, useState) will not hydrate')}\n`)
    }
  }

  const entryContents = hasRoutes
    ? buildSyntheticEntry({ routes, staticRoutesPath, prodEntry, clientBundleCode })
    : `require(${JSON.stringify(prodEntry)});`

  const result = await esbuild.build({
    stdin: {
      contents: entryContents,
      resolveDir: projectRoot,
      sourcefile: '<murasaki-prod-entry>.cjs',
      loader: 'js',
    },
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['@webviewjs/webview', 'esbuild', 'tsx', 'fsevents'],
    loader: { '.css': 'text' },
    minify: false,
    sourcemap: 'inline',
    banner: {
      js: [
        '#!/usr/bin/env node',
        'var __murasaki_meta_url = require("url").pathToFileURL(__filename).href;',
        'globalThis.__murasakiRequire = require;',
      ].join('\n'),
    },
    define: { 'import.meta.url': '__murasaki_meta_url' },
    logLevel: 'silent',
  })
  if (result.errors.length) {
    out(`   ${red('✗')} bundle failed:\n`)
    for (const e of result.errors) out(`     ${e.text}\n`)
    process.exit(1)
  }

  const serverPath = join(distDir, 'server.cjs')
  writeFileSync(serverPath, result.outputFiles[0].text)
  try {
    chmodSync(serverPath, 0o755)
  } catch {}
  const kb = (result.outputFiles[0].text.length / 1024).toFixed(1)
  out(`     ${green('✓')} ${dim('built')} ${serverPath} ${dim(`(${kb} KB)`)}\n\n`)

  // Minimal package.json next to server.cjs for "just node-execute and ship"
  try {
    const consumerPkgPath = join(projectRoot, 'package.json')
    if (existsSync(consumerPkgPath)) {
      const pkg = JSON.parse(readFileSync(consumerPkgPath, 'utf8'))
      writeFileSync(
        join(distDir, 'package.json'),
        JSON.stringify(
          {
            name: pkg.name,
            version: pkg.version,
            private: true,
            main: 'server.cjs',
            dependencies: {
              '@webviewjs/webview': pkg.dependencies?.['@webviewjs/webview'] ?? '*',
              esbuild: pkg.dependencies?.esbuild ?? '*',
            },
          },
          null,
          2,
        ),
      )
    }
  } catch {}

  return serverPath
}

// ── stage 2: native distributables ─────────────────────────────────

/** Native dependencies we need to ship alongside server.cjs. */
const RUNTIME_DEPS = ['@webviewjs/webview', 'esbuild']

/**
 * Locate a dependency's installed root directory by resolving its
 * package.json. Works through pnpm symlink chains and transitive deps
 * (`@webviewjs/webview` is a dep of murasaki, not the user's app).
 */
async function resolveDepRoot(dep: string): Promise<string | null> {
  try {
    const { createRequire } = await import('node:module')
    const req = createRequire(join(projectRoot, 'package.json'))
    // Resolve the dep's package.json explicitly so we get the dir, not
    // the resolved main entry (which would be inside dist/ or similar).
    const pkgJson = req.resolve(`${dep}/package.json`)
    return dirname(pkgJson)
  } catch {
    return null
  }
}

/**
 * Locate a @webviewjs/webview-<platform>[-<arch>[-msvc|-gnu]] prebuild
 * package. pnpm doesn't hoist optionalDependencies to the consumer's
 * node_modules, so a plain resolveDepRoot from projectRoot can miss it.
 * Instead we first find @webviewjs/webview and resolve the prebuild from
 * that package's own base — which always works because the prebuild is
 * declared in webview's optionalDependencies.
 */
async function resolvePrebuildFromWebview(prebuildPkg: string): Promise<string | null> {
  // First try the consumer's direct hoisted layout (works for npm/yarn).
  const direct = await resolveDepRoot(prebuildPkg)
  if (direct) return direct

  // Fallback: resolve via the webview package's own node_modules.
  const webviewRoot = await resolveDepRoot('@webviewjs/webview')
  if (!webviewRoot) return null
  try {
    const { createRequire } = await import('node:module')
    const req = createRequire(join(webviewRoot, 'package.json'))
    const pkgJson = req.resolve(`${prebuildPkg}/package.json`)
    return dirname(pkgJson)
  } catch {
    return null
  }
}

/**
 * strip -x the given Node binary in place. Reduces size ~20% (115 MB → 92 MB
 * on macOS arm64). On macOS the code signature is invalidated by strip, so
 * we re-sign ad-hoc afterwards. Failures are non-fatal — we log a warning
 * and ship the unstripped binary.
 */
async function stripNodeBinary(binaryPath: string, target: Target): Promise<boolean> {
  // Windows: no equivalent tool in the standard PATH. Handled via WiX cab
  // compression on the .msi side instead.
  if (target.os === 'win32') return false
  try {
    await runOrFail('strip', ['-x', binaryPath], {
      label: 'strip',
      allowFail: false,
    })
    if (target.os === 'darwin') {
      // strip invalidates the code signature; ad-hoc re-sign.
      await runOrFail('codesign', ['--sign', '-', '--force', binaryPath], {
        label: 'codesign (post-strip)',
        allowFail: false,
      })
    }
    return true
  } catch (e) {
    out(
      `     ${red('!')} strip failed: ${(e as Error).message} — shipping unstripped (~20 MB larger)\n`,
    )
    return false
  }
}

async function copyRuntimeDeps(targetNodeModules: string, target: Target): Promise<string[]> {
  mkdirSync(targetNodeModules, { recursive: true })
  const copied: string[] = []
  for (const dep of RUNTIME_DEPS) {
    const src = await resolveDepRoot(dep)
    if (!src) continue
    const dst = join(targetNodeModules, dep)
    rmSync(dst, { recursive: true, force: true })
    // dereference so we copy actual files (not pnpm's symlink chain)
    cpSync(src, dst, { recursive: true, dereference: true })
    copied.push(dep)
  }
  // Always ship the target-platform-specific @webviewjs/webview native
  // prebuild package. The main package's js-bindings.js dynamically requires
  // it (e.g. `require('@webviewjs/webview-darwin-arm64')`); without it, the
  // bundled app aborts with "Cannot find native binding" the moment the
  // webview is imported. Works from pnpm's hoisted node_modules for the host
  // target and via npm registry download for cross-compile targets.
  const platformPart =
    target.os === 'win32'
      ? `${target.os}-${target.arch}-msvc`
      : target.os === 'linux'
        ? `${target.os}-${target.arch}-gnu`
        : `${target.os}-${target.arch}`
  const pkgName = `@webviewjs/webview-${platformPart}`

  let prebuildSrc: string | null = null
  let prebuildFetchError: Error | null = null

  if (target.id === currentTarget().id) {
    // Prefer a local copy: the prebuild is @webviewjs/webview's own
    // optionalDependency, so pnpm keeps it inside webview's private
    // node_modules rather than hoisting it to the consumer. Resolve from
    // the webview package's base so it works regardless of hoist layout.
    prebuildSrc = await resolvePrebuildFromWebview(pkgName)
  }

  if (!prebuildSrc) {
    // Fall back to fetching it straight from the npm registry. This handles
    // both cross-compile targets and hosts whose pnpm strict layout blocks
    // even the nested resolve above.
    try {
      out(
        `     ${dim('· ' + pkgName + ' not resolvable locally — downloading from npm registry')}\n`,
      )
      prebuildSrc = await ensureWebviewPrebuild(target)
    } catch (e) {
      prebuildFetchError = e as Error
    }
  }

  if (!prebuildSrc) {
    // The bundle will not run without this. Fail loudly rather than shipping
    // a broken .app.
    const msg = [
      `Cannot locate ${pkgName}.`,
      `The bundled app will crash on launch without it because @webviewjs/webview's`,
      `js-bindings dynamically requires this native prebuild package.`,
      '',
      `Tried:`,
      `  1. resolving from the consumer's node_modules`,
      `  2. resolving from @webviewjs/webview's own node_modules`,
      `  3. downloading from https://registry.npmjs.org/${pkgName.replace('/', '%2F')}`,
      prebuildFetchError ? `     (last error: ${prebuildFetchError.message})` : '',
      '',
      `Fix:`,
      `  pnpm add ${pkgName}          # (recommended, pins the version)`,
      `  npm i --include=optional     # (if you use npm)`,
    ]
      .filter(Boolean)
      .join('\n')
    throw new Error(msg)
  }

  const dst = join(targetNodeModules, pkgName)
  rmSync(dst, { recursive: true, force: true })
  cpSync(prebuildSrc, dst, { recursive: true, dereference: true })
  copied.push(pkgName)

  return copied
}

type PackOpts = { slim: boolean }

// ── stage 2a: macOS .app ──────────────────────────────────────────
async function packMacApp(
  distDir: string,
  serverPath: string,
  target: Target,
  packOpts: PackOpts,
): Promise<string> {
  const meta = await resolveAppMeta()
  const appName = readAppName()
  const displayName = meta.name ?? capitalize(appName)
  const bundleId = meta.bundleId
  const appBundle = join(distDir, `${displayName}.app`)
  const nodeVersion = meta.runtime?.node ?? DEFAULT_NODE_VERSION

  out(
    `   ${dim('2.')} packaging macOS ${bold(displayName + '.app')} ${dim('(' + target.id + (packOpts.slim ? ', slim' : '') + ')')}\n`,
  )

  try {
    rmSync(appBundle, { recursive: true, force: true })
  } catch {}
  const macOSDir = join(appBundle, 'Contents/MacOS')
  const resourcesDir = join(appBundle, 'Contents/Resources')
  mkdirSync(macOSDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })

  // Node binary — in slim mode, the launcher downloads it on first launch
  // instead of bundling ~90 MB into the .app.
  if (!packOpts.slim) {
    const nodeBinary = await ensureNodeBinary(target)
    const nodeDest = join(resourcesDir, 'node')
    cpSync(nodeBinary, nodeDest)
    chmodSync(nodeDest, 0o755)
    const stripped = await stripNodeBinary(nodeDest, target)
    out(`     ${green('✓')} ${dim('node      →')} Resources/node${stripped ? dim(' (stripped)') : ''}\n`)
  } else {
    out(`     ${dim('· node       skipped (slim: downloaded at first launch)')}\n`)
  }

  // server.cjs into Resources/
  cpSync(serverPath, join(resourcesDir, 'server.cjs'))
  out(`     ${green('✓')} ${dim('server.cjs →')} Resources/server.cjs\n`)

  // node_modules (selected runtime deps) into Resources/
  const deps = await copyRuntimeDeps(join(resourcesDir, 'node_modules'), target)
  out(`     ${green('✓')} ${dim('node_modules →')} Resources/node_modules (${deps.join(', ')})\n`)

  // launcher script (must be executable by MacOS/<displayName>)
  const launcherPath = join(macOSDir, displayName)
  const launcher = packOpts.slim
    ? macSlimLauncher({ displayName, bundleId, nodeVersion, arch: target.arch })
    : `#!/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)/Resources"
cd "$DIR"
exec "$DIR/node" "$DIR/server.cjs"
`
  writeFileSync(launcherPath, launcher)
  chmodSync(launcherPath, 0o755)
  out(`     ${green('✓')} ${dim('launcher  →')} MacOS/${displayName}${packOpts.slim ? dim(' (slim)') : ''}\n`)

  // Info.plist
  writeFileSync(
    join(appBundle, 'Contents/Info.plist'),
    macInfoPlist({
      displayName,
      bundleId,
      version: meta.version,
      category: meta.category ?? 'public.app-category.utilities',
      copyright: meta.copyright,
    }),
  )

  // Optional icon
  if (meta.icon) {
    try {
      const iconSrc = join(projectRoot, meta.icon)
      if (existsSync(iconSrc)) {
        cpSync(iconSrc, join(resourcesDir, 'AppIcon.icns'))
        out(`     ${green('✓')} ${dim('icon       →')} Resources/AppIcon.icns\n`)
      }
    } catch {}
  }
  out(`     ${green('✓')} ${dim('Info.plist')}\n`)

  // Ad-hoc codesign (re-sign because we modified contents)
  await runOrFail('codesign', ['--sign', '-', '--force', '--deep', appBundle], {
    label: 'codesign .app',
    allowFail: true,
  })

  out(`     ${green('✓')} ${dim('built')} ${appBundle}\n`)
  return appBundle
}

// ── stage 2b: Windows folder + .bat launcher ───────────────────────
async function packWindows(
  distDir: string,
  serverPath: string,
  target: Target,
  packOpts: PackOpts,
): Promise<string> {
  if (packOpts.slim) {
    out(`   ${red('!')} --slim is currently macOS-only; falling back to bundled runtime on Windows\n`)
  }
  const meta = await resolveAppMeta()
  const appName = readAppName()
  const dir = join(distDir, appName)

  out(`   ${dim('2.')} packaging windows folder ${bold(appName + '/')} ${dim('(' + target.id + ')')}\n`)

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
  mkdirSync(dir, { recursive: true })

  const nodeBinary = await ensureNodeBinary(target)
  cpSync(nodeBinary, join(dir, 'node.exe'))
  // Windows: no host-tool for shrinking .exe; WiX cab compression handles it
  // on the installer side.
  out(`     ${green('✓')} ${dim('node.exe')}\n`)

  cpSync(serverPath, join(dir, 'server.cjs'))
  out(`     ${green('✓')} ${dim('server.cjs')}\n`)

  const deps = await copyRuntimeDeps(join(dir, 'node_modules'), target)
  out(`     ${green('✓')} ${dim('node_modules')} (${deps.join(', ')})\n`)

  // Double-click launcher: .bat for command, .vbs for "no console window"
  const batPath = join(dir, `${appName}.bat`)
  writeFileSync(batPath, `@echo off\r\n"%~dp0node.exe" "%~dp0server.cjs"\r\n`)
  out(`     ${green('✓')} ${dim('launcher  →')} ${appName}.bat\n`)

  // VBS wrapper to avoid the black console window flash on double-click
  const vbsPath = join(dir, `${appName}.vbs`)
  const vbs = `Set ws = CreateObject("Wscript.Shell")
ws.Run """" & WScript.ScriptFullName & "\\..\\${appName}.bat" & """", 0
`
  writeFileSync(vbsPath, vbs)
  out(`     ${green('✓')} ${dim('launcher  →')} ${appName}.vbs (silent)\n`)

  // Optional icon
  if (meta.icon) {
    try {
      const iconSrc = join(projectRoot, meta.icon)
      if (existsSync(iconSrc)) {
        cpSync(iconSrc, join(dir, 'app.ico'))
        out(`     ${green('✓')} ${dim('icon       →')} app.ico\n`)
      }
    } catch {}
  }

  out(`     ${green('✓')} ${dim('built')} ${dir}\n`)
  return dir
}

// ── stage 2c: Linux folder + sh launcher ───────────────────────────
async function packLinux(
  distDir: string,
  serverPath: string,
  target: Target,
  packOpts: PackOpts,
): Promise<string> {
  if (packOpts.slim) {
    out(`   ${red('!')} --slim is currently macOS-only; falling back to bundled runtime on Linux\n`)
  }
  const meta = await resolveAppMeta()
  const appName = readAppName()
  const dir = join(distDir, appName)

  out(`   ${dim('2.')} packaging linux folder ${bold(appName + '/')} ${dim('(' + target.id + ')')}\n`)

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
  mkdirSync(dir, { recursive: true })

  const nodeBinary = await ensureNodeBinary(target)
  const nodeDest = join(dir, 'node')
  cpSync(nodeBinary, nodeDest)
  chmodSync(nodeDest, 0o755)
  const stripped = await stripNodeBinary(nodeDest, target)
  out(`     ${green('✓')} ${dim('node')}${stripped ? dim(' (stripped)') : ''}\n`)

  cpSync(serverPath, join(dir, 'server.cjs'))
  out(`     ${green('✓')} ${dim('server.cjs')}\n`)

  const deps = await copyRuntimeDeps(join(dir, 'node_modules'), target)
  out(`     ${green('✓')} ${dim('node_modules')} (${deps.join(', ')})\n`)

  const shPath = join(dir, `${appName}.sh`)
  writeFileSync(
    shPath,
    `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/server.cjs"
`,
  )
  chmodSync(shPath, 0o755)
  out(`     ${green('✓')} ${dim('launcher  →')} ${appName}.sh\n`)

  // Optional icon
  if (meta.icon) {
    try {
      const iconSrc = join(projectRoot, meta.icon)
      if (existsSync(iconSrc)) {
        cpSync(iconSrc, join(dir, 'app.png'))
        out(`     ${green('✓')} ${dim('icon       →')} app.png\n`)
      }
    } catch {}
  }

  out(`     ${green('✓')} ${dim('built')} ${dir}\n`)
  return dir
}

// ── stage 3: installers / archives ─────────────────────────────────

async function makeDmg(distDir: string, appPath: string): Promise<string> {
  const meta = await resolveAppMeta()
  const appName = readAppName()
  const displayName = meta.name ?? capitalize(appName)
  const dmgPath = join(distDir, `${displayName}-${readVersion()}.dmg`)
  const stagingPath = join(distDir, `.dmg-staging-${Date.now()}.dmg`)
  const volumeName = displayName
  const mountPoint = join('/Volumes', volumeName)

  const dmgOpts = meta.dmg ?? {}
  const [winW, winH] = dmgOpts.windowSize ?? [540, 380]
  const iconSize = dmgOpts.iconSize ?? 128
  const [appX, appY] = dmgOpts.appPosition ?? [140, 190]
  const [asX, asY] = dmgOpts.applicationsPosition ?? [400, 190]
  const backgroundSrc = dmgOpts.background ? join(projectRoot, dmgOpts.background) : null

  out(`   ${dim('3.')} packaging macOS ${bold(displayName + '.dmg')} ${dim('(drag-to-install layout)')}\n`)

  // Clean up any leftovers.
  try {
    rmSync(dmgPath, { force: true })
  } catch {}
  try {
    rmSync(stagingPath, { force: true })
  } catch {}
  // Detach any pre-existing mount at this point (interrupted previous run).
  await runOrFail('hdiutil', ['detach', mountPoint, '-force'], {
    label: 'hdiutil detach (pre)',
    allowFail: true,
  })

  // 1. Create a writable staging image big enough for the app + slack.
  //    Sized dynamically at 1.25x the app footprint, min 60 MB.
  const appSizeBytes = folderSize(appPath)
  const paddedMb = Math.max(60, Math.ceil((appSizeBytes * 1.25) / 1024 / 1024))
  await runOrFail(
    'hdiutil',
    [
      'create',
      '-srcfolder',
      appPath,
      '-volname',
      volumeName,
      '-fs',
      'HFS+',
      '-fsargs',
      '-c c=64,a=16,e=16',
      '-format',
      'UDRW',
      '-size',
      `${paddedMb}m`,
      stagingPath,
    ],
    { label: 'hdiutil create (staging)' },
  )
  out(`     ${green('✓')} ${dim('staging image')} ${dim(`(${paddedMb} MB)`)}\n`)

  // 2. Mount the staging image.
  await runOrFail(
    'hdiutil',
    ['attach', stagingPath, '-readwrite', '-noverify', '-noautoopen', '-mountpoint', mountPoint],
    { label: 'hdiutil attach' },
  )

  try {
    // 3. Symlink /Applications so users can drag straight in.
    await runOrFail('ln', ['-s', '/Applications', join(mountPoint, 'Applications')], {
      label: 'ln -s Applications',
    })

    // 4. Optional background image.
    let backgroundStanza = ''
    if (backgroundSrc && existsSync(backgroundSrc)) {
      const bgDir = join(mountPoint, '.background')
      mkdirSync(bgDir, { recursive: true })
      const ext = backgroundSrc.toLowerCase().endsWith('.jpg') ? 'jpg' : 'png'
      const bgFile = `background.${ext}`
      cpSync(backgroundSrc, join(bgDir, bgFile))
      backgroundStanza = `      set background picture of viewOptions to file ".background:${bgFile}"\n`
      out(`     ${green('✓')} ${dim('background   →')} .background/${bgFile}\n`)
    }

    // 5. Configure Finder view via osascript. Runs against the mounted volume.
    const applescript = `tell application "Finder"
  tell disk "${volumeName}"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, ${200 + winW}, ${120 + winH}}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to ${iconSize}
    set text size of viewOptions to 13
    set label position of viewOptions to bottom
${backgroundStanza}    set position of item "${displayName}.app" of container window to {${appX}, ${appY}}
    set position of item "Applications" of container window to {${asX}, ${asY}}
    update without registering applications
    delay 0.5
    close
  end tell
end tell
`
    await runOrFail('osascript', ['-e', applescript], {
      label: 'osascript (Finder layout)',
      allowFail: true, // osascript layout is nice-to-have; don't abort if it hiccups
    })
    out(`     ${green('✓')} ${dim('finder layout applied')}\n`)

    // Give Finder a moment to write .DS_Store, then flush.
    await new Promise((r) => setTimeout(r, 800))
    await runOrFail('sync', [], { label: 'sync', allowFail: true })
  } finally {
    // 6. Detach.
    await runOrFail('hdiutil', ['detach', mountPoint, '-force'], {
      label: 'hdiutil detach',
      allowFail: true,
    })
  }

  // 7. Convert staging (UDRW) → final (UDZO compressed, read-only).
  await runOrFail(
    'hdiutil',
    ['convert', stagingPath, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', dmgPath],
    { label: 'hdiutil convert (UDZO)' },
  )

  // 8. Clean up staging.
  try {
    rmSync(stagingPath, { force: true })
  } catch {}

  out(`     ${green('✓')} ${dim('built')} ${dmgPath}\n`)
  return dmgPath
}

function folderSize(root: string): number {
  let total = 0
  const stack = [root]
  while (stack.length) {
    const p = stack.pop() as string
    let s
    try {
      s = statSync(p)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      let entries: string[] = []
      try {
        entries = readdirSync(p)
      } catch {}
      for (const e of entries) stack.push(join(p, e))
    } else {
      total += s.size
    }
  }
  return total
}

/**
 * Cross-platform zip — uses zip(1) on POSIX, Compress-Archive on Windows.
 * Works regardless of which host you build on.
 */
async function makeZipCross(distDir: string, folderPath: string): Promise<string> {
  const appName = readAppName()
  const zipPath = join(distDir, `${appName}-${readVersion()}.zip`)

  out(`   ${dim('3.')} packaging zip ${bold(appName + '.zip')}\n`)
  try {
    rmSync(zipPath, { force: true })
  } catch {}

  const parentDir = dirname(folderPath)
  const baseName = folderPath.slice(parentDir.length + 1)

  if (process.platform === 'win32') {
    await runOrFail(
      'powershell',
      [
        '-Command',
        `Compress-Archive -Path "${folderPath}\\*" -DestinationPath "${zipPath}" -Force`,
      ],
      { label: 'powershell Compress-Archive' },
    )
  } else {
    // POSIX zip(1) — preserves file modes (chmod +x on launcher).
    // Run from parentDir so the archive paths are relative to the folder.
    await runOrFail('zip', ['-r', '-q', zipPath, baseName], {
      label: 'zip -r',
      cwd: parentDir,
    })
  }
  out(`     ${green('✓')} ${dim('built')} ${zipPath}\n`)
  return zipPath
}

async function makeZip(distDir: string, folderPath: string): Promise<string> {
  const appName = readAppName()
  const zipPath = join(distDir, `${appName}-${readVersion()}.zip`)

  out(`   ${dim('3.')} packaging windows ${bold(appName + '.zip')}\n`)
  try {
    rmSync(zipPath, { force: true })
  } catch {}

  // PowerShell Compress-Archive — built into Windows.
  await runOrFail(
    'powershell',
    [
      '-Command',
      `Compress-Archive -Path "${folderPath}\\*" -DestinationPath "${zipPath}" -Force`,
    ],
    { label: 'powershell Compress-Archive' },
  )
  out(`     ${green('✓')} ${dim('built')} ${zipPath}\n`)
  return zipPath
}

async function makeTarGz(distDir: string, folderPath: string): Promise<string> {
  const appName = readAppName()
  const tarPath = join(distDir, `${appName}-${readVersion()}.tar.gz`)

  out(`   ${dim('3.')} packaging linux ${bold(appName + '.tar.gz')}\n`)
  try {
    rmSync(tarPath, { force: true })
  } catch {}

  const parentDir = dirname(folderPath)
  const baseName = folderPath.slice(parentDir.length + 1)
  await runOrFail('tar', ['-C', parentDir, '-czf', tarPath, baseName], {
    label: 'tar -czf',
  })
  out(`     ${green('✓')} ${dim('built')} ${tarPath}\n`)
  return tarPath
}

// ── helpers ────────────────────────────────────────────────────────
/**
 * Slim-mode launcher for macOS. On first launch it asks the user via a
 * native `osascript` dialog whether to download the Node runtime
 * (~30 MB), extracts it to ~/.murasaki/runtime/<bundleId>/node-<version>/,
 * and re-executes itself.
 */
function macSlimLauncher(opts: {
  displayName: string
  bundleId: string
  nodeVersion: string
  arch: 'x64' | 'arm64'
}): string {
  const dl = `https://nodejs.org/dist/${opts.nodeVersion}/node-${opts.nodeVersion}-darwin-${opts.arch}.tar.gz`
  // shell-escape only the strings that vary; the rest is a static template.
  const displayName = opts.displayName.replace(/"/g, '\\"')
  return `#!/bin/bash
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="$APP_DIR/Resources"

RUNTIME_ROOT="$HOME/.murasaki/runtime/${opts.bundleId}"
NODE_DIR="$RUNTIME_ROOT/node-${opts.nodeVersion}-darwin-${opts.arch}"
NODE_BIN="$NODE_DIR/bin/node"

if [ ! -x "$NODE_BIN" ]; then
  ANSWER=$(osascript -e 'display dialog "${displayName} needs the Node.js runtime (~30 MB). Download now?" buttons {"Cancel", "Download"} default button "Download" with title "${displayName}" with icon note' 2>/dev/null || echo "cancel")
  case "$ANSWER" in
    *"Download"*) ;;
    *) exit 1 ;;
  esac

  mkdir -p "$RUNTIME_ROOT"
  # Progress dialog runs in a subshell we kill after extraction.
  ( osascript -e 'display dialog "Setting up runtime for ${displayName}…\\n\\nThis only happens once." buttons {} giving up after 999' 2>/dev/null ) &
  PROGRESS_PID=$!

  # Download + extract in one pipe.
  if ! curl -fsSL "${dl}" | tar -xzC "$RUNTIME_ROOT"; then
    kill "$PROGRESS_PID" 2>/dev/null || true
    osascript -e 'display alert "Runtime download failed" message "Check your network connection and try again."' 2>/dev/null || true
    exit 1
  fi

  kill "$PROGRESS_PID" 2>/dev/null || true
fi

cd "$RESOURCES"
exec "$NODE_BIN" "$RESOURCES/server.cjs"
`
}

function macInfoPlist(opts: {
  displayName: string
  bundleId: string
  version: string
  category: string
  copyright?: string
}): string {
  const copyrightLine = opts.copyright
    ? `  <key>NSHumanReadableCopyright</key>\n  <string>${escapeXml(opts.copyright)}</string>\n`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${escapeXml(opts.displayName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapeXml(opts.bundleId)}</string>
  <key>CFBundleName</key>
  <string>${escapeXml(opts.displayName)}</string>
  <key>CFBundleDisplayName</key>
  <string>${escapeXml(opts.displayName)}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleShortVersionString</key>
  <string>${escapeXml(opts.version)}</string>
  <key>CFBundleVersion</key>
  <string>${escapeXml(opts.version)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSApplicationCategoryType</key>
  <string>${escapeXml(opts.category)}</string>
${copyrightLine}</dict>
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

function buildSyntheticEntry(args: {
  routes: Route[]
  staticRoutesPath: string
  prodEntry: string
  clientBundleCode: string
}): string {
  const { routes, staticRoutesPath, prodEntry, clientBundleCode } = args
  const rootLayoutFile =
    routes[0]?.layoutFiles.find((p) => p.endsWith('/app/layout.tsx')) ?? null
  const layoutFiles = Array.from(new Set(routes.flatMap((r) => r.layoutFiles)))

  const pageRequires = routes
    .map((r, i) => `const page${i} = require(${JSON.stringify(r.pageFile)});`)
    .join('\n')
  const layoutRequires = layoutFiles
    .map((p, i) => `const layout${i} = require(${JSON.stringify(p)});`)
    .join('\n')
  const layoutVar = (file: string) => `layout${layoutFiles.indexOf(file)}`
  const routeEntries = routes
    .map(
      (r, i) =>
        `  { path: ${JSON.stringify(r.path)}, page: page${i}, layouts: [${r.layoutFiles
          .map(layoutVar)
          .join(', ')}], pageFile: ${JSON.stringify(r.pageFile)}, layoutFiles: ${JSON.stringify(r.layoutFiles)} }`,
    )
    .join(',\n')

  const globalsRequire = existsSync(APP_GLOBALS_CSS)
    ? `const globalsCss = require(${JSON.stringify(APP_GLOBALS_CSS)});`
    : `const globalsCss = '';`

  return `${pageRequires}
${layoutRequires}
${globalsRequire}
const { setStaticRoutes } = require(${JSON.stringify(staticRoutesPath)});
setStaticRoutes({
  rootLayout: ${rootLayoutFile ? layoutVar(rootLayoutFile) : 'null'},
  rootLayoutFile: ${rootLayoutFile ? JSON.stringify(rootLayoutFile) : 'null'},
  routes: [
${routeEntries}
  ],
  globalsCss: typeof globalsCss === 'string' ? globalsCss : (globalsCss && globalsCss.default) || '',
  clientBundle: ${JSON.stringify(clientBundleCode)},
});
require(${JSON.stringify(prodEntry)});
`
}

function readAppName(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    let raw = pkg.name || 'app'
    // Strip the scope prefix on scoped packages: "@scope/name" → "name".
    if (raw.startsWith('@')) {
      const slash = raw.indexOf('/')
      raw = slash > 0 ? raw.slice(slash + 1) : raw.slice(1)
    }
    return raw.replace(/[^a-z0-9-]/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'app'
  } catch {
    return 'app'
  }
}

function readBundleId(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    return pkg.murasaki?.bundleId ?? null
  } catch {
    return null
  }
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function capitalize(s: string): string {
  return s
    .split(/[-_\s]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function runOrFail(
  cmd: string,
  args: string[],
  opts: { label: string; allowFail?: boolean; cwd?: string } = { label: cmd },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: opts.cwd })
    let stderr = ''
    p.stdout.on('data', () => {})
    p.stderr.on('data', (c) => {
      stderr += c.toString()
    })
    p.on('error', reject)
    p.on('exit', (code) => {
      if (code === 0) return resolve()
      if (opts.allowFail) return resolve()
      out(`   ${red('✗')} ${opts.label} failed (exit ${code}):\n${stderr}\n`)
      reject(new Error(`${opts.label} exit ${code}`))
    })
  })
}
