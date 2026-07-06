import { resolve, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile, rm, cp, copyFile, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import build from './build.js'
import buildServer from './build-server.js'
import { dim, success, warn } from './brand.js'
import type { MurasakiConfig } from '../config.js'
import { DEFAULT_LOCALES } from '../menu-i18n.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Pack `dist/client` + `dist/server` (the `'use server'` action registry) +
 * a copy of the current Node runtime + `assets/prod-server.mjs` + the
 * compiled `murasaki-launcher` native binary into a macOS `.app` bundle.
 *
 * production has no Vite dev server — `murasaki-launcher` (Rust,
 * crates/native/src/launcher.rs) spawns `prod-server.mjs`, a small Node HTTP
 * server that serves `dist/client` and runs actions out of the `dist/server`
 * registry, then points the native WebView at it over
 * `http://127.0.0.1:<port>/`. This mirrors dev (Vite dev server) closely
 * enough that the client's `/__murasaki/action/…` fetch works unchanged in
 * both.
 */
export default async function bundle(argv: string[]) {
  const cwd = process.cwd()
  const config = await loadUserConfig(cwd)
  // Rebuild the client every time by default — bundling is a release step, so
  // silently packaging a stale `dist/client` from an earlier run is a footgun.
  // `--no-build` opts back into reuse (but still builds if it's missing).
  const skipBuild = argv.includes('--no-build')
  if (!skipBuild || !existsSync(resolve(cwd, 'dist/client'))) await build(argv)
  // Always (re)built — cheap relative to the client build, and must exist
  // before packaging even if dist/client was already up to date.
  await buildServer(cwd, resolve(cwd, 'src'))

  if (process.platform !== 'darwin') {
    process.stdout.write(`\n${warn('bundle: only macOS is supported right now.')}\n\n`)
    return
  }

  const productName = config.productName
  const appDir = resolve(cwd, 'dist/bundle', `${productName}.app`)
  await rm(appDir, { recursive: true, force: true })

  const macosDir = join(appDir, 'Contents/MacOS')
  const resourcesDir = join(appDir, 'Contents/Resources')
  await mkdir(macosDir, { recursive: true })
  await mkdir(resourcesDir, { recursive: true })

  // Contents/Resources/node_modules/@murasakijs/native — resolved once, used
  // both to locate the compiled launcher binary below and to vendor the
  // native binding itself (see the node_modules copy further down).
  const nativeDir = resolveNativeModuleDir(cwd)

  // Contents/MacOS/<productName> — the compiled `murasaki-launcher` Rust
  // binary (crates/native/src/bin/murasaki-launcher.rs). Being a *real*
  // Mach-O executable — rather than a bash script execing a renamed copy of
  // node — is what makes macOS show the correct product name + icon in the
  // Dock, Cmd-Tab, and the bold menu-bar title. It spawns
  // `Resources/node prod-server.mjs` as a child process and drives the
  // webview itself (see crates/native/src/launcher.rs); `prod-launcher.mjs`
  // is no longer used at runtime.
  const launcherBinary = await resolveLauncherBinary(nativeDir)
  const launcherDest = join(macosDir, productName)
  await copyFile(launcherBinary, launcherDest)
  await chmod(launcherDest, 0o755)
  // macOS (arm64 in particular) refuses to launch an unsigned main
  // executable — ad-hoc sign it (no identity, no entitlements) since we
  // don't have a Developer ID at bundle time. Best-effort: warn rather than
  // fail if codesign is unavailable — it ships with Xcode Command Line
  // Tools, which `murasaki bundle` already depends on for sips/iconutil.
  const signResult = spawnSync('codesign', ['-s', '-', '-f', launcherDest])
  if (signResult.status !== 0) {
    process.stdout.write(
      `\n${warn(`codesign failed for ${dim(launcherDest)} — the bundle may refuse to launch.`)}\n\n`,
    )
  }

  // Contents/Resources/node — a plain copy of the current Node runtime. It's
  // now a child process spawned by the launcher binary above rather than the
  // app's main executable, so its filename no longer affects the Dock/
  // menu-bar label (that used to require renaming it to the product name).
  // Distributing to other machines needs a downloaded, target-specific node
  // (ensureNodeBinary-style fetch); that lands in a later phase. For now we
  // ship whatever node is running this CLI, which is enough to run on this
  // machine.
  const nodeDest = join(resourcesDir, 'node')
  await copyFile(process.execPath, nodeDest)
  await chmod(nodeDest, 0o755)

  // Contents/Resources/prod-server.mjs — spawned by the launcher binary.
  const prodServerSrc = resolve(__dirname, '../../assets/prod-server.mjs')
  await copyFile(prodServerSrc, join(resourcesDir, 'prod-server.mjs'))

  // Contents/Resources/menu-locales.json — read by the launcher binary at
  // runtime to localize the default app menu for the end user's locale (see
  // crates/native/src/launcher.rs).
  const menuLocalesSrc = resolve(__dirname, '../menu-locales.json')
  await copyFile(menuLocalesSrc, join(resourcesDir, 'menu-locales.json'))

  // Contents/Resources/icon.icns + icon.png — the .icns backs the .app's
  // Finder/DMG appearance (via CFBundleIconFile below); the plain PNG is
  // read at runtime by the launcher binary to set NSApp.applicationIconImage,
  // which covers the About panel (CFBundleIconFile doesn't reliably reach it
  // — see crates/native/src/launcher.rs's set_app_icon).
  const iconResource = config.icon ? await buildIcon(cwd, config.icon, resourcesDir) : null

  // Contents/Resources/murasaki-meta.json
  await writeFile(
    join(resourcesDir, 'murasaki-meta.json'),
    JSON.stringify(
      {
        appId: config.appId,
        productName,
        version: config.version ?? '0.0.0',
        description: config.description,
        copyright: config.copyright,
        homepage: config.homepage,
        authors: config.authors,
        locales: config.locales,
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

  // Contents/Resources/server — the 'use server' action registry bundle
  // (dist/server/actions.mjs), built self-contained (see build-server.ts)
  // so no project node_modules need to ship alongside it.
  await cp(resolve(cwd, 'dist/server'), join(resourcesDir, 'server'), {
    recursive: true,
  })

  // Contents/Resources/node_modules/@murasakijs/native — external native
  // binding, copied as-is since its .node binary is arch-specific and
  // can't go through esbuild/tsc.
  // TODO: no longer needed at runtime once verified — prod-server.mjs is pure
  // HTTP and the launcher binary is native Rust, so nothing at runtime
  // currently requires this package. Kept for now to minimize risk.
  const nativeDest = join(resourcesDir, 'node_modules/@murasakijs/native')
  await mkdir(dirname(nativeDest), { recursive: true })
  await cp(nativeDir, nativeDest, { recursive: true })

  // Contents/Info.plist
  await writeFile(
    join(appDir, 'Contents/Info.plist'),
    infoPlist(config, productName, iconResource !== null),
  )

  process.stdout.write(`\n${success(`bundle written  ${dim(appDir)}`)}\n\n`)
}

/**
 * Locate the installed `@murasakijs/native` package dir. Resolve from the user
 * project first (the normal, hoisted case), then fall back to resolving from
 * murasaki's own location — `@murasakijs/native` is murasaki's dependency, so
 * this succeeds even when a package manager nests it under
 * `node_modules/murasaki/node_modules/` (e.g. `file:`/link installs) rather
 * than hoisting it to the project root.
 */
function resolveNativeModuleDir(cwd: string): string {
  const bases = [resolve(cwd, 'package.json'), fileURLToPath(import.meta.url)]
  for (const base of bases) {
    try {
      return dirname(createRequire(base).resolve('@murasakijs/native/package.json'))
    } catch {
      // try the next resolution base
    }
  }
  throw new Error(
    "murasaki: couldn't resolve @murasakijs/native — make sure it's installed (it ships as a dependency of murasaki).",
  )
}

/**
 * Locate the compiled `murasaki-launcher` binary for the current host.
 * Published `@murasakijs/native` ships prebuilt binaries named
 * `murasaki-launcher.<napi-triple>` (see .github/workflows/native-release.yml
 * and crates/native/package.json's `files`), matching the `.node` bindings'
 * `murasaki-native.<napi-triple>.node` naming. Falls back to a local
 * `cargo build --release --bin murasaki-launcher` output for development,
 * where `@murasakijs/native` resolves to a workspace link to crates/native
 * itself rather than a published package.
 */
async function resolveLauncherBinary(nativeDir: string): Promise<string> {
  const triple = `darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  const candidates = [
    join(nativeDir, `murasaki-launcher.${triple}`),
    join(nativeDir, 'target/release/murasaki-launcher'),
    resolve(__dirname, '../../../../crates/native/target/release/murasaki-launcher'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `murasaki: launcher binary not found — @murasakijs/native must ship murasaki-launcher.${triple}; rebuild native or update @murasakijs/native.`,
  )
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
    process.stdout.write(`\n${warn(`icon: ${iconPath} not found, skipping`)}\n\n`)
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

  // Runtime icon (NSApp.applicationIconImage, set by the launcher binary) —
  // plain PNG, no conversion needed.
  await copyFile(src, join(resourcesDir, 'icon.png'))

  return 'icon.png'
}

function infoPlist(config: MurasakiConfig, productName: string, hasIcon: boolean): string {
  const appId = escapeXml(config.appId)
  const name = escapeXml(productName)
  const version = escapeXml(config.version ?? '0.0.0')
  const locales = config.locales ?? DEFAULT_LOCALES
  const localizationsXml = locales.map((l) => `    <string>${escapeXml(l)}</string>`).join('\n')
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
  <key>NSHighResolutionCapable</key><true/>
  <!-- Languages the app supports. Declaring them lets macOS localize its own
       injected UI (the Edit menu's Start Dictation / Emoji & Symbols / Writing
       Tools items, standard dialogs, …) into the user's language. Driven by
       config.locales, defaulting to every language murasaki ships default-menu
       translations for (see src/menu-i18n.ts's DEFAULT_LOCALES / src/menu-locales.json). -->
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleLocalizations</key>
  <array>
${localizationsXml}
  </array>${hasIcon ? '\n  <key>CFBundleIconFile</key><string>icon</string>' : ''}
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
