// `murasaki build [--binary] [--app]` — production build pipeline.
//
// Stages:
//   1. esbuild bundles murasaki/prod + the runtime into dist/server.js
//      (always)
//   2. --binary  → Node SEA (Single Executable Application):
//        - write sea-config.json
//        - `node --experimental-sea-config` produces sea-prep.blob
//        - copy current Node binary to dist/<app>
//        - postject inject the blob
//        - ad-hoc codesign on macOS
//   3. --app     → macOS .app bundle wrapping the binary
//        - implies --binary
//        - dist/<AppName>.app/Contents/{Info.plist,MacOS/<app>,Resources/}
//
// Native dep caveat: @webviewjs/webview is still external (it's a .node
// binary). Distribute dist/<app> + node_modules/@webviewjs/webview side
// by side, or copy the @webviewjs build artefact into the .app's
// Resources/ folder. Real "single, self-contained file" requires bundling
// the .node, which is in the v0.17 roadmap.

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
import { projectRoot } from './env.ts'

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
  binary?: boolean
  app?: boolean
}

export async function build(opts: BuildOptions = {}): Promise<void> {
  if (opts.app) opts.binary = true
  const startAt = Date.now()
  const distDir = join(projectRoot, 'dist')
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

  out(`\n   ${bold(bright('🦋 Murasaki'))} — production build\n\n`)
  out(`   ${dim('Project ')}${projectRoot}\n`)
  out(`   ${dim('Out     ')}${distDir}/\n\n`)

  // ── 1. esbuild bundle ───────────────────────────────────────────
  const serverPath = await bundleServer(distDir)

  // ── 2. Optional Node SEA ────────────────────────────────────────
  let binaryPath: string | null = null
  if (opts.binary) {
    binaryPath = await buildBinary(distDir, serverPath)
  }

  // ── 3. Optional macOS .app wrap ─────────────────────────────────
  let appPath: string | null = null
  if (opts.app) {
    if (process.platform !== 'darwin') {
      out(`   ${red('!')} --app is macOS-only; skipping bundle wrap\n`)
    } else if (binaryPath) {
      appPath = await buildMacApp(distDir, binaryPath)
    }
  }

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1)
  out(`\n   ${green('✓')} done ${dim(`(${elapsed}s)`)}\n\n`)
  out(`   ${dim('Run:')} ${bold('node ' + serverPath)}\n`)
  if (binaryPath) out(`   ${dim('     ')}${bold(binaryPath)}\n`)
  if (appPath) out(`   ${dim('     ')}${bold('open ' + appPath)}\n`)
  out('\n')
}

// ── stage 1 ────────────────────────────────────────────────────────
async function bundleServer(distDir: string): Promise<string> {
  const esbuild = await import('esbuild')

  // Locate murasaki/dist/prod.js
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'prod.js'),
    join(here, '../dist/prod.js'),
    join(projectRoot, 'node_modules/murasaki/dist/prod.js'),
  ]
  const entry = candidates.find((p) => existsSync(p))
  if (!entry) {
    out(`   ${red('✗')} could not locate murasaki/dist/prod.js\n`)
    process.exit(1)
  }

  out(`   ${dim('1.')} bundling server (esbuild)\n`)
  out(`     ${dim('entry  ')}${entry}\n`)

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node22',
    // CJS so the bundle is compatible with Node SEA (which currently
    // requires the main entry to be CommonJS).
    format: 'cjs',
    // tsx is bundled (not external) so SEA mode can find it via globalThis
    // require — SEA's require only resolves Node built-ins.
    external: ['@webviewjs/webview', 'esbuild', 'fsevents'],
    loader: { '.css': 'text' },
    minify: false,
    sourcemap: 'inline',
    // banner:
    //   - shebang for direct execution
    //   - require('tsx/cjs') so user .tsx pages can be required at runtime
    //   - __murasaki_meta_url = a real file URL for the bundle, fed into
    //     code that uses `import.meta.url` (rewritten via define below).
    banner: {
      js: [
        '#!/usr/bin/env node',
        // tsx/cjs is statically imported by prod.tsx, so the bundle
        // registers the .tsx loader itself when it boots — no banner
        // require needed (and SEA can't resolve external requires anyway).
        'var __murasaki_meta_url = require("url").pathToFileURL(__filename).href;',
        // Expose CJS require to bundled code that runs in a "could be ESM
        // too" environment (render.tsx falls back to dynamic import without it).
        'globalThis.__murasakiRequire = require;',
      ].join('\n'),
    },
    // esbuild stubs `import.meta` to {} in CJS by default. Rewrite the
    // .url access to our pre-computed identifier (entity-name only here).
    define: {
      'import.meta.url': '__murasaki_meta_url',
    },
    logLevel: 'silent',
  })
  if (result.errors.length) {
    out(`   ${red('✗')} bundle failed:\n`)
    for (const e of result.errors) out(`     ${e.text}\n`)
    process.exit(1)
  }

  // .cjs extension so Node treats it as CommonJS regardless of any
  // upstream package.json "type": "module".
  const serverPath = join(distDir, 'server.cjs')
  writeFileSync(serverPath, result.outputFiles[0].text)
  try {
    chmodSync(serverPath, 0o755)
  } catch {}
  const kb = (result.outputFiles[0].text.length / 1024).toFixed(1)
  out(`     ${green('✓')} ${dim('built')} ${serverPath} ${dim(`(${kb} KB)`)}\n\n`)

  // Minimal package.json hint for distribution
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
              tsx: pkg.dependencies?.tsx ?? '*',
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

// ── stage 2: Node SEA ──────────────────────────────────────────────
async function buildBinary(distDir: string, serverPath: string): Promise<string> {
  const appName = readAppName()
  const binaryPath = join(distDir, appName)

  out(`   ${dim('2.')} packaging as single-executable (Node SEA)\n`)
  out(
    `     ${red('!')} ${dim('experimental:')} tsx + esbuild can't fully resolve inside SEA;\n`,
  )
  out(`        ${dim('the binary may fail at runtime — prefer `node server.cjs` for now.')}\n`)

  // 2a. sea-config.json
  const seaConfigPath = join(distDir, 'sea-config.json')
  const blobPath = join(distDir, 'sea-prep.blob')
  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: serverPath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: true,
      },
      null,
      2,
    ),
  )

  // 2b. Generate blob via current Node binary
  await runOrFail(process.execPath, ['--experimental-sea-config', seaConfigPath], {
    label: 'sea-config → blob',
  })
  out(`     ${green('✓')} ${dim('blob')} ${blobPath}\n`)

  // 2c. Copy current Node binary as the target
  cpSync(process.execPath, binaryPath)
  try {
    chmodSync(binaryPath, 0o755)
  } catch {}
  out(`     ${green('✓')} ${dim('copied node →')} ${binaryPath}\n`)

  // 2d. Remove macOS code signature before postject (it would invalidate it).
  if (process.platform === 'darwin') {
    await runOrFail('codesign', ['--remove-signature', binaryPath], {
      label: 'remove old signature',
      allowFail: true,
    })
  }

  // 2e. Inject the blob via postject (Node API). It has no .d.ts so suppress.
  // @ts-expect-error - no types shipped
  const postjectMod = await import('postject')
  const postject = postjectMod as {
    inject: (
      binary: string,
      resource: string,
      data: Buffer,
      opts: { sentinelFuse: string; machoSegmentName?: string },
    ) => Promise<void>
  }
  const blob = readFileSync(blobPath)
  await postject.inject(binaryPath, 'NODE_SEA_BLOB', blob, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  })
  out(`     ${green('✓')} ${dim('postject injected')}\n`)

  // 2f. macOS: re-sign (ad-hoc — no Developer ID required)
  if (process.platform === 'darwin') {
    await runOrFail('codesign', ['--sign', '-', '--force', binaryPath], {
      label: 'codesign --sign -',
    })
    out(`     ${green('✓')} ${dim('ad-hoc signed')}\n`)
  }

  // 2g. Cleanup
  try {
    rmSync(blobPath)
    rmSync(seaConfigPath)
  } catch {}

  return binaryPath
}

// ── stage 3: macOS .app wrap ───────────────────────────────────────
async function buildMacApp(distDir: string, binaryPath: string): Promise<string> {
  const appName = readAppName()
  const displayName = capitalize(appName)
  const bundleId = readBundleId() ?? `app.${appName.replace(/[^a-z0-9]/gi, '')}.murasaki`
  const appBundle = join(distDir, `${displayName}.app`)

  out(`   ${dim('3.')} wrapping as ${displayName}.app\n`)

  // Clean any prior bundle.
  try {
    rmSync(appBundle, { recursive: true, force: true })
  } catch {}

  const macOSDir = join(appBundle, 'Contents/MacOS')
  const resourcesDir = join(appBundle, 'Contents/Resources')
  mkdirSync(macOSDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })

  // Move the binary into the bundle
  const innerBinary = join(macOSDir, displayName)
  cpSync(binaryPath, innerBinary)
  try {
    chmodSync(innerBinary, 0o755)
  } catch {}

  // Info.plist
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${displayName}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleName</key>
  <string>${displayName}</string>
  <key>CFBundleDisplayName</key>
  <string>${displayName}</string>
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
  writeFileSync(join(appBundle, 'Contents/Info.plist'), plist)

  // Re-codesign the .app bundle
  await runOrFail('codesign', ['--sign', '-', '--force', '--deep', appBundle], {
    label: 'codesign .app',
    allowFail: true,
  })

  out(`     ${green('✓')} ${dim('built')} ${appBundle}\n`)
  return appBundle
}

// ── helpers ────────────────────────────────────────────────────────
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
