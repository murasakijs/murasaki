import { resolve, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile, rm, cp, copyFile, chmod, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import build from './build.js'
import buildServer from './build-server.js'
import { dim, success, warn, unsignedNote } from './brand.js'
import { ensureNodeBinary } from './node-runtime.js'
import type { MurasakiConfig } from '../config.js'
import { DEFAULT_LOCALES } from '../menu-i18n.js'

type Arch = 'arm64' | 'x64'

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
  // Target arch for the produced .app — defaults to the host arch, but
  // `--arch arm64`/`--arch x64` lets a single arm64 dev machine also produce
  // an Intel build (and vice versa). Drives both the fetched Node runtime and
  // the `murasaki-launcher` binary selection below.
  const arch = parseArch(argv)
  // Rebuild the client every time by default — bundling is a release step, so
  // silently packaging a stale `dist/client` from an earlier run is a footgun.
  // `--no-build` opts back into reuse (but still builds if it's missing).
  const skipBuild = argv.includes('--no-build')
  // Real Developer ID signing (see signApp below) instead of the default
  // ad-hoc launcher signature. Off by default — murasaki ships no
  // certificate, so this only works once the app developer supplies their
  // own (config.sign.identity / $MURASAKI_SIGN_IDENTITY / their keychain).
  const shouldSign = argv.includes('--sign')
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
  const launcherBinary = await resolveLauncherBinary(nativeDir, arch)
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

  // Contents/Resources/node — a downloaded, target-specific Node runtime
  // (official nodejs.org macOS build, checksum-verified and cached under
  // ~/.murasaki/node/, see node-runtime.ts), not whatever node happens to be
  // running this CLI. That matters for two reasons: the CLI's own node might
  // be the wrong architecture for a cross-arch build (--arch), and even for
  // the host arch it could be a Homebrew/nvm build linked against libs that
  // aren't present on other machines. It's a child process spawned by the
  // launcher binary above rather than the app's main executable, so its
  // filename no longer affects the Dock/menu-bar label (that used to require
  // renaming it to the product name).
  const nodeSrc = await ensureNodeBinary(arch, process.versions.node)
  const nodeDest = join(resourcesDir, 'node')
  await copyFile(nodeSrc, nodeDest)
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

  // Real Developer ID signing, on top of the ad-hoc launcher signature
  // applied above — see signApp's doc comment for the full flow.
  if (shouldSign) await signApp(appDir, config)

  process.stdout.write(`\n${success(`bundle written  ${dim(appDir)}`)}\n\n`)

  if (!shouldSign) process.stdout.write(unsignedNote(appDir))
}

/**
 * Real Developer ID signing for `--sign`, following Apple's documented
 * hardened-runtime signing flow (prerequisite for notarization — see
 * installer.ts's `--notarize`): https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
 *
 * murasaki ships no certificate of its own — this signs with whatever
 * Developer ID Application identity the app developer supplies via
 * $MURASAKI_SIGN_IDENTITY, `config.sign.identity`, or their keychain.
 */
async function signApp(appDir: string, config: MurasakiConfig): Promise<void> {
  const identity = resolveSignIdentity(config)
  const entitlements = await resolveEntitlements(config)

  // Sign inner code first, then the outer bundle — codesign requires nested
  // code to already carry a valid signature before the containing bundle is
  // sealed. `--deep` is deliberately not used: it's an Apple-documented
  // anti-pattern that hides which nested binaries actually got signed.
  const resourcesDir = join(appDir, 'Contents/Resources')
  const targets: string[] = []
  const nodeBin = join(resourcesDir, 'node')
  if (existsSync(nodeBin)) targets.push(nodeBin)
  targets.push(...(await findNodeAddons(resourcesDir)))
  targets.push(join(appDir, 'Contents/MacOS', config.productName))
  targets.push(appDir)

  for (const target of targets) {
    const result = spawnSync(
      'codesign',
      [
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        '--entitlements',
        entitlements,
        '--sign',
        identity,
        target,
      ],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) {
      throw new Error(`murasaki: codesign failed for ${target}:\n${result.stderr.trim()}`)
    }
  }

  const verify = spawnSync('codesign', ['--verify', '--strict', appDir], { encoding: 'utf8' })
  if (verify.status !== 0) {
    throw new Error(`murasaki: codesign --verify --strict failed:\n${verify.stderr.trim()}`)
  }

  // Gatekeeper (spctl) legitimately says "rejected" for a signed-but-not-yet-
  // notarized build — that's expected here, so it's logged for visibility
  // rather than treated as a failure. `murasaki installer --notarize` is what
  // actually clears it.
  const spctl = spawnSync('spctl', ['-a', '-vv', appDir], { encoding: 'utf8' })
  process.stdout.write(`\n${dim((spctl.stderr || spctl.stdout).trim())}\n`)

  process.stdout.write(`\n${success(`signed with ${dim(identity)}`)}\n`)
}

/**
 * Resolve the Developer ID Application identity to sign with. Priority:
 * $MURASAKI_SIGN_IDENTITY > `config.sign.identity` > auto-detected from the
 * signer's keychain (`security find-identity`) — the common case for a
 * solo developer who already has exactly one.
 */
function resolveSignIdentity(config: MurasakiConfig): string {
  if (process.env.MURASAKI_SIGN_IDENTITY) return process.env.MURASAKI_SIGN_IDENTITY
  if (config.sign?.identity) return config.sign.identity

  const find = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  })
  const line = find.stdout?.split('\n').find((l) => l.includes('Developer ID Application'))
  const quoted = line?.match(/"([^"]+)"/)?.[1]
  if (quoted) return quoted
  const hash = line?.match(/\b([0-9A-Fa-f]{40})\b/)?.[1]
  if (hash) return hash

  throw new Error(
    'murasaki: --sign: no Developer ID Application identity found (set MURASAKI_SIGN_IDENTITY, ' +
      'config.sign.identity, or add one to your keychain — needs a paid Apple Developer account).',
  )
}

/**
 * Entitlements for the hardened-runtime signing above. Uses
 * `config.sign.entitlements` if it's set and exists; otherwise writes a
 * default plist to a temp file. Node needs the JIT + unsigned-executable-
 * memory + no-library-validation entitlements to keep launching once the
 * hardened runtime is on — it JITs and loads unsigned `.node` add-ons.
 */
async function resolveEntitlements(config: MurasakiConfig): Promise<string> {
  const custom = config.sign?.entitlements ? resolve(process.cwd(), config.sign.entitlements) : null
  if (custom && existsSync(custom)) return custom

  const dir = await mkdtemp(join(tmpdir(), 'murasaki-entitlements-'))
  const path = join(dir, 'entitlements.plist')
  await writeFile(path, DEFAULT_ENTITLEMENTS_PLIST)
  return path
}

const DEFAULT_ENTITLEMENTS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
`

/** Recursively collect every `*.node` native add-on under `dir` — each needs
 * its own hardened-runtime signature before the outer bundle is sealed. */
async function findNodeAddons(dir: string): Promise<string[]> {
  const acc: string[] = []
  await walkNodeAddons(dir, acc)
  return acc
}

async function walkNodeAddons(dir: string, acc: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkNodeAddons(full, acc)
    } else if (entry.name.endsWith('.node')) {
      acc.push(full)
    }
  }
}

/**
 * `--arch arm64|x64`, defaulting to the host arch (macOS only runs on these
 * two). Lets an arm64 dev machine also produce an Intel `.app` (and vice
 * versa) by fetching the matching Node runtime and launcher binary below.
 */
function parseArch(argv: string[]): Arch {
  const i = argv.indexOf('--arch')
  const value = i >= 0 ? argv[i + 1] : (process.arch as Arch)
  if (value !== 'arm64' && value !== 'x64') {
    throw new Error(`murasaki: --arch must be "arm64" or "x64", got ${JSON.stringify(value)}`)
  }
  return value
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
 * Locate the compiled `murasaki-launcher` binary for the target arch.
 * Published `@murasakijs/native` ships prebuilt binaries named
 * `murasaki-launcher.<napi-triple>` (see .github/workflows/native-release.yml
 * and crates/native/package.json's `files`), matching the `.node` bindings'
 * `murasaki-native.<napi-triple>.node` naming — this resolves correctly for
 * cross-arch builds too, since both triples ship in the package. Falls back
 * to a local `cargo build --release --bin murasaki-launcher` output for
 * development, where `@murasakijs/native` resolves to a workspace link to
 * crates/native itself rather than a published package — but only when
 * `arch` matches the host, since that output is never cross-compiled.
 */
async function resolveLauncherBinary(nativeDir: string, arch: Arch): Promise<string> {
  const triple = `darwin-${arch}`
  const candidates = [join(nativeDir, `murasaki-launcher.${triple}`)]
  if (arch === process.arch) {
    candidates.push(
      join(nativeDir, 'target/release/murasaki-launcher'),
      resolve(__dirname, '../../../../crates/native/target/release/murasaki-launcher'),
    )
  }
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
