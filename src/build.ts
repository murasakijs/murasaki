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
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_DIR, APP_GLOBALS_CSS, projectRoot } from './env.ts'
import { discoverRoutes, type Route } from './runtime/routes.ts'

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
  /** Produce a native distributable folder/.app for the current platform. */
  pack?: boolean
  /** Wrap the --pack output in a per-OS installer/archive. Implies --pack. */
  installer?: boolean
}

export async function build(opts: BuildOptions = {}): Promise<void> {
  if (opts.installer) opts.pack = true
  const startAt = Date.now()
  const distDir = join(projectRoot, 'dist')
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

  out(`\n   ${bold(bright('🦋 Murasaki'))} — production build\n\n`)
  out(`   ${dim('Project ')}${projectRoot}\n`)
  out(`   ${dim('Out     ')}${distDir}/\n\n`)

  const serverPath = await bundleServer(distDir)

  let packPath: string | null = null
  if (opts.pack) {
    if (process.platform === 'darwin') packPath = await packMacApp(distDir, serverPath)
    else if (process.platform === 'win32') packPath = await packWindows(distDir, serverPath)
    else packPath = await packLinux(distDir, serverPath)
  }

  let installerPath: string | null = null
  if (opts.installer && packPath) {
    if (process.platform === 'darwin') installerPath = await makeDmg(distDir, packPath)
    else if (process.platform === 'win32') installerPath = await makeZip(distDir, packPath)
    else installerPath = await makeTarGz(distDir, packPath)
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

  const entryContents = hasRoutes
    ? buildSyntheticEntry({ routes, staticRoutesPath, prodEntry })
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

async function copyRuntimeDeps(targetNodeModules: string): Promise<string[]> {
  mkdirSync(targetNodeModules, { recursive: true })
  const copied: string[] = []
  for (const dep of RUNTIME_DEPS) {
    const src = await resolveDepRoot(dep)
    if (!src) continue
    const dst = join(targetNodeModules, dep)
    rmSync(dst, { recursive: true, force: true })
    // dereference so we copy the actual files (not pnpm's symlink chain)
    cpSync(src, dst, { recursive: true, dereference: true })
    copied.push(dep)
  }
  return copied
}

// ── stage 2a: macOS .app ──────────────────────────────────────────
async function packMacApp(distDir: string, serverPath: string): Promise<string> {
  const appName = readAppName()
  const displayName = capitalize(appName)
  const bundleId = readBundleId() ?? `app.${appName.replace(/[^a-z0-9]/gi, '')}.murasaki`
  const appBundle = join(distDir, `${displayName}.app`)

  out(`   ${dim('2.')} packaging macOS ${bold(displayName + '.app')}\n`)

  try {
    rmSync(appBundle, { recursive: true, force: true })
  } catch {}
  const macOSDir = join(appBundle, 'Contents/MacOS')
  const resourcesDir = join(appBundle, 'Contents/Resources')
  mkdirSync(macOSDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })

  // Node binary into Resources/
  cpSync(process.execPath, join(resourcesDir, 'node'))
  chmodSync(join(resourcesDir, 'node'), 0o755)
  out(`     ${green('✓')} ${dim('node      →')} Resources/node\n`)

  // server.cjs into Resources/
  cpSync(serverPath, join(resourcesDir, 'server.cjs'))
  out(`     ${green('✓')} ${dim('server.cjs →')} Resources/server.cjs\n`)

  // node_modules (selected runtime deps) into Resources/
  const deps = await copyRuntimeDeps(join(resourcesDir, 'node_modules'))
  out(`     ${green('✓')} ${dim('node_modules →')} Resources/node_modules (${deps.join(', ')})\n`)

  // launcher script (must be executable by MacOS/<displayName>)
  const launcherPath = join(macOSDir, displayName)
  const launcher = `#!/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)/Resources"
cd "$DIR"
exec "$DIR/node" "$DIR/server.cjs"
`
  writeFileSync(launcherPath, launcher)
  chmodSync(launcherPath, 0o755)
  out(`     ${green('✓')} ${dim('launcher  →')} MacOS/${displayName}\n`)

  // Info.plist
  writeFileSync(join(appBundle, 'Contents/Info.plist'), macInfoPlist({ displayName, bundleId }))
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
async function packWindows(distDir: string, serverPath: string): Promise<string> {
  const appName = readAppName()
  const dir = join(distDir, appName)

  out(`   ${dim('2.')} packaging windows folder ${bold(appName + '/')}\n`)

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
  mkdirSync(dir, { recursive: true })

  cpSync(process.execPath, join(dir, 'node.exe'))
  out(`     ${green('✓')} ${dim('node.exe')}\n`)

  cpSync(serverPath, join(dir, 'server.cjs'))
  out(`     ${green('✓')} ${dim('server.cjs')}\n`)

  const deps = await copyRuntimeDeps(join(dir, 'node_modules'))
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

  out(`     ${green('✓')} ${dim('built')} ${dir}\n`)
  return dir
}

// ── stage 2c: Linux folder + sh launcher ───────────────────────────
async function packLinux(distDir: string, serverPath: string): Promise<string> {
  const appName = readAppName()
  const dir = join(distDir, appName)

  out(`   ${dim('2.')} packaging linux folder ${bold(appName + '/')}\n`)

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
  mkdirSync(dir, { recursive: true })

  cpSync(process.execPath, join(dir, 'node'))
  chmodSync(join(dir, 'node'), 0o755)
  out(`     ${green('✓')} ${dim('node')}\n`)

  cpSync(serverPath, join(dir, 'server.cjs'))
  out(`     ${green('✓')} ${dim('server.cjs')}\n`)

  const deps = await copyRuntimeDeps(join(dir, 'node_modules'))
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

  out(`     ${green('✓')} ${dim('built')} ${dir}\n`)
  return dir
}

// ── stage 3: installers / archives ─────────────────────────────────

async function makeDmg(distDir: string, appPath: string): Promise<string> {
  const appName = readAppName()
  const displayName = capitalize(appName)
  const dmgPath = join(distDir, `${displayName}-${readVersion()}.dmg`)

  out(`   ${dim('3.')} packaging macOS ${bold(displayName + '.dmg')}\n`)

  // Remove any existing artefact (hdiutil refuses to overwrite).
  try {
    rmSync(dmgPath, { force: true })
  } catch {}

  await runOrFail(
    'hdiutil',
    [
      'create',
      '-volname',
      displayName,
      '-srcfolder',
      appPath,
      '-ov',
      '-format',
      'UDZO', // compressed read-only
      dmgPath,
    ],
    { label: 'hdiutil create .dmg' },
  )
  out(`     ${green('✓')} ${dim('built')} ${dmgPath}\n`)
  return dmgPath
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
function macInfoPlist(opts: { displayName: string; bundleId: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${opts.displayName}</string>
  <key>CFBundleIdentifier</key>
  <string>${opts.bundleId}</string>
  <key>CFBundleName</key>
  <string>${opts.displayName}</string>
  <key>CFBundleDisplayName</key>
  <string>${opts.displayName}</string>
  <key>CFBundleShortVersionString</key>
  <string>${readVersion()}</string>
  <key>CFBundleVersion</key>
  <string>${readVersion()}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.utilities</string>
</dict>
</plist>
`
}

function buildSyntheticEntry(args: {
  routes: Route[]
  staticRoutesPath: string
  prodEntry: string
}): string {
  const { routes, staticRoutesPath, prodEntry } = args
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
          .join(', ')}] }`,
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
  routes: [
${routeEntries}
  ],
  globalsCss: typeof globalsCss === 'string' ? globalsCss : (globalsCss && globalsCss.default) || '',
});
require(${JSON.stringify(prodEntry)});
`
}

function readAppName(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    return (pkg.name || 'app').replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'app'
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
  opts: { label: string; allowFail?: boolean } = { label: cmd },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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
