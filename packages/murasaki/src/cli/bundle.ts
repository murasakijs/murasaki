import { resolve, dirname, join, relative, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile, rm, cp, copyFile, chmod, readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import pngToIco from 'png-to-ico'
import { PNG } from 'pngjs'
import { NtExecutable, NtExecutableResource, Data, Resource } from 'resedit'
import build from './build.js'
import buildServer from './build-server.js'
import { dim, success, warn, unsignedNote } from './brand.js'
import { ensureNodeBinary, type NodePlatform } from './node-runtime.js'
import {
  resolveWindowDeclarations,
  validateMainShutdownTimeoutMs,
  type MurasakiConfig,
} from '../config.js'
import { resolveUpdater } from '../resolve-updater.js'
import { DEFAULT_LOCALES } from '../menu-i18n.js'
import { stageBundleResources, stageServerDependencies } from './server-dependencies.js'
import { resolveAssociations } from '../associations.js'
import { loadUserConfig } from './load-config.js'
import { signWindowsArtifact } from './windows-signing.js'

export { loadUserConfig } from './load-config.js'

export type Arch = 'arm64' | 'x64'
export type Platform = NodePlatform

/** `--target <platform>-<arch>` (or `config.targets[0]`, or the host). */
export type BundleTarget = { platform: Platform; arch: Arch }

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
  // Target platform+arch for the produced bundle — defaults to the host
  // platform/arch, but `--target win32-x64` (etc.) or `config.targets[0]`
  // cross-bundles a different platform from this machine. `--arch
  // arm64`/`--arch x64` (no `--target`) keeps working exactly as before for
  // the host platform, e.g. letting a single arm64 Mac also produce an Intel
  // `.app`. Drives both the fetched Node runtime and the `murasaki-launcher`
  // binary selection below.
  const target = parseTarget(argv, config)
  // Rebuild the client every time by default — bundling is a release step, so
  // silently packaging a stale `dist/client` from an earlier run is a footgun.
  // `--no-build` opts back into reuse (but still builds if it's missing).
  const skipBuild = argv.includes('--no-build')
  // Real Developer ID signing (see signApp below) instead of the default
  // ad-hoc launcher signature. Off by default — murasaki ships no
  // certificate, so this only works once the app developer supplies their
  // own (config.sign.identity / $MURASAKI_SIGN_IDENTITY / their keychain).
  const shouldSign = argv.includes('--sign')
  if (target.platform === 'win32' && shouldSign && process.platform !== 'win32') {
    throw new Error(
      'murasaki: Windows Authenticode signing requires Windows and SignTool. ' +
        'Cross-bundle without --sign, then run the signed release job on Windows.',
    )
  }
  if (!skipBuild || !existsSync(resolve(cwd, 'dist/client'))) await build(argv)
  // Always (re)built — cheap relative to the client build, and must exist
  // before packaging even if dist/client was already up to date.
  await buildServer(cwd, resolve(cwd, 'src'), config)

  // The win32 folder layout below has no macOS-only dependency (no
  // codesign/sips/iconutil/plist), so unlike the darwin path it can be
  // produced from any host — including this one, for cross-bundling / CI
  // verification off a Mac.
  if (target.platform === 'win32') {
    await bundleWin32(cwd, config, target.arch, shouldSign)
    return
  }

  if (target.platform !== 'darwin') {
    process.stdout.write(`\n${warn(`bundle: ${target.platform} is not supported yet.`)}\n\n`)
    return
  }

  if (process.platform !== 'darwin') {
    process.stdout.write(
      `\n${warn('bundle: a darwin .app can only be built while running on macOS (win32 targets can be cross-bundled from anywhere).')}\n\n`,
    )
    return
  }

  const arch = target.arch
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
  const launcherBinary = await resolveLauncherBinary(nativeDir, 'darwin', arch)
  const launcherDest = join(macosDir, productName)
  await copyFile(launcherBinary, launcherDest)
  await chmod(launcherDest, 0o755)
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
  const nodeSrc = await ensureNodeBinary('darwin', arch, process.versions.node)
  const nodeDest = join(resourcesDir, 'node')
  await copyFile(nodeSrc, nodeDest)
  await chmod(nodeDest, 0o755)

  // Contents/Resources/prod-server.mjs — spawned by the launcher binary.
  const prodServerSrc = resolve(__dirname, '../../assets/prod-server.mjs')
  await copyFile(prodServerSrc, join(resourcesDir, 'prod-server.mjs'))

  // Contents/Resources/updater-engine.mjs — the compiled updater engine
  // (src/runtime/updater.ts → dist/runtime/updater.js) that prod-server.mjs
  // imports. This IS the security boundary (Ed25519 manifest verification):
  // there must be exactly one implementation of it, shared by dev (mounted
  // via src/vite-plugin/updater.ts) and prod. `dist/runtime/updater.js`
  // compiles to standalone ESM (only `node:` imports — its one non-builtin
  // import, `ResolvedUpdater`, is `import type` and erased), so it can be
  // copied as-is; named `.mjs` since there's no package.json in the
  // resources dir to declare `"type": "module"`.
  const updaterEngineSrc = resolve(__dirname, '../runtime/updater.js')
  await copyFile(updaterEngineSrc, join(resourcesDir, 'updater-engine.mjs'))

  // Contents/Resources/wire.mjs — the exact same versioned Server Action
  // codec used by Vite in dev. Keeping this as one compiled implementation
  // prevents supported values from changing between `murasaki dev` and a
  // packaged app.
  const wireCodecSrc = resolve(__dirname, '../runtime/wire.js')
  await copyFile(wireCodecSrc, join(resourcesDir, 'wire.mjs'))

  // Contents/Resources/main-runtime.mjs — lifecycle runner shared by dev and prod.
  const mainRuntimeSrc = resolve(__dirname, '../runtime/main-runtime.js')
  await copyFile(mainRuntimeSrc, join(resourcesDir, 'main-runtime.mjs'))

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
    metaJson(config, productName, iconResource, cwd),
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

  // Node main/server dependencies are deliberately externalized during the
  // SSR build so native add-ons, dynamic loaders, package data, and packages
  // such as ws retain their normal Node behavior. Stage the detected package
  // graph as real directories (portable even when the project uses pnpm
  // symlinks), then copy developer-declared non-code resources.
  await stageServerDependencies(cwd, resolve(cwd, 'dist/server'), resourcesDir, config, target)
  await stageBundleResources(cwd, resourcesDir, config)

  // Contents/Resources/node_modules/@murasakijs/native — external native
  // binding, copied as-is since its .node binary is arch-specific and
  // can't go through esbuild/tsc.
  // TODO: no longer needed at runtime once verified — prod-server.mjs is pure
  // HTTP and the launcher binary is native Rust, so nothing at runtime
  // currently requires this package. Kept for now to minimize risk.
  const nativeDest = join(resourcesDir, 'node_modules/@murasakijs/native')
  await mkdir(dirname(nativeDest), { recursive: true })
  await copyNativeModule(nativeDir, nativeDest, target)

  // Contents/Info.plist
  await writeFile(
    join(appDir, 'Contents/Info.plist'),
    infoPlist(config, productName, iconResource !== null),
  )

  // Sign only after every resource and Info.plist entry is in place. Signing
  // the launcher earlier makes codesign create a bundle resource seal before
  // Resources/ is populated; the final .app then fails verification with
  // "a sealed resource is missing or invalid". Developer ID builds use the
  // explicit inner-to-outer flow below. Unsigned distributions still need a
  // valid ad-hoc bundle signature so macOS can launch and verify the app.
  if (shouldSign) {
    await signApp(appDir, config)
  } else {
    const signResult = spawnSync('codesign', ['--force', '--sign', '-', appDir], { encoding: 'utf8' })
    if (signResult.status !== 0) {
      throw new Error(`murasaki: ad-hoc codesign failed for ${appDir}:\n${signResult.stderr.trim()}`)
    }
    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', appDir], { encoding: 'utf8' })
    if (verify.status !== 0) {
      throw new Error(`murasaki: ad-hoc codesign verification failed for ${appDir}:\n${verify.stderr.trim()}`)
    }
  }

  process.stdout.write(`\n${success(`bundle written  ${dim(appDir)}`)}\n\n`)

  // dist/bundle/<productName>-darwin-<arch>.app.zip — the macOS auto-update
  // payload (murasaki release --manifest / --sign). Must run AFTER signApp
  // above so the zip carries the code signature — see zipDarwinApp's doc
  // comment for why this shells out to `ditto` rather than `zip`.
  const zipPath = await zipDarwinApp(resolve(cwd, 'dist/bundle'), productName, arch, appDir)
  process.stdout.write(`\n${success(`zip written  ${dim(zipPath)}`)}\n\n`)

  if (!shouldSign) process.stdout.write(unsignedNote(appDir))
}

/**
 * Stage a Windows app FOLDER at `dist/bundle/<productName>/` — VS Code-style:
 * `<productName>.exe` at the folder root, with a sibling `resources/`
 * directory the launcher resolves as `<dir-of-exe>/resources/`. This is the
 * win32 counterpart of the `.app` staged above, minus everything macOS-only
 * (no codesign, Info.plist, or .icns — Windows has no equivalent bundle
 * manifest at this layer; product name/icon are read from the .exe's PE
 * resources, set by the launcher build in crates/native, not here).
 *
 * Has no macOS-only dependency, so — unlike the `.app` path above — this can
 * run on any host, including this one for cross-bundling off a Mac.
 */
async function bundleWin32(
  cwd: string,
  config: MurasakiConfig,
  arch: Arch,
  shouldSign: boolean,
): Promise<void> {
  const productName = config.productName
  const outDir = resolve(cwd, 'dist/bundle', productName)
  await rm(outDir, { recursive: true, force: true })

  const resourcesDir = join(outDir, 'resources')
  await mkdir(outDir, { recursive: true })
  await mkdir(resourcesDir, { recursive: true })

  // resources/node_modules/@murasakijs/native — resolved once, used both to
  // locate the compiled launcher binary below and to vendor the native
  // binding itself, same as the macOS path.
  const nativeDir = resolveNativeModuleDir(cwd)

  // <productName>.exe — the compiled `murasaki-launcher` Rust binary for
  // win32-<arch> (crates/native/src/bin/murasaki-launcher.rs, Phase 1b).
  const launcherBinary = await resolveLauncherBinary(nativeDir, 'win32', arch)
  await copyFile(launcherBinary, join(outDir, `${productName}.exe`))

  // resources/node.exe — a downloaded, target-specific Node runtime
  // (official nodejs.org win32 build, checksum-verified and cached under
  // ~/.murasaki/node/, see node-runtime.ts), fetched even when bundling from
  // a non-Windows host.
  const nodeSrc = await ensureNodeBinary('win32', arch, process.versions.node)
  await copyFile(nodeSrc, join(resourcesDir, 'node.exe'))

  // resources/prod-server.mjs — spawned by the launcher binary.
  const prodServerSrc = resolve(__dirname, '../../assets/prod-server.mjs')
  await copyFile(prodServerSrc, join(resourcesDir, 'prod-server.mjs'))

  // resources/updater-engine.mjs — see the macOS path above for why this is
  // copied verbatim rather than mirrored by hand.
  const updaterEngineSrc = resolve(__dirname, '../runtime/updater.js')
  await copyFile(updaterEngineSrc, join(resourcesDir, 'updater-engine.mjs'))

  // resources/wire.mjs — shared dev/prod Server Action wire codec.
  const wireCodecSrc = resolve(__dirname, '../runtime/wire.js')
  await copyFile(wireCodecSrc, join(resourcesDir, 'wire.mjs'))

  // resources/main-runtime.mjs — lifecycle runner shared by dev and prod.
  const mainRuntimeSrc = resolve(__dirname, '../runtime/main-runtime.js')
  await copyFile(mainRuntimeSrc, join(resourcesDir, 'main-runtime.mjs'))

  // resources/menu-locales.json — read by the launcher binary at runtime to
  // localize the default app menu for the end user's locale.
  const menuLocalesSrc = resolve(__dirname, '../menu-locales.json')
  await copyFile(menuLocalesSrc, join(resourcesDir, 'menu-locales.json'))

  // resources/icon.ico + icon.png — the .ico is what actually makes
  // Explorer/taskbar/title bar show the app's icon (see
  // embedWin32ExeResources below); the plain PNG is kept alongside it for
  // parity with the macOS bundle's runtime-readable icon.png (currently
  // unused at win32 runtime — see imp_win's doc comment in launcher.rs).
  const iconResource = config.icon ? await buildWin32Icon(cwd, config.icon, resourcesDir) : null

  // Embed resources/icon.ico + version-info (ProductName, FileVersion,
  // CompanyName, …) into <productName>.exe's PE resources — this is what
  // Explorer/taskbar/title bar/Start menu actually read; without it the
  // prebuilt launcher binary shows Windows' generic default icon. No-op if
  // iconResource is null (icon generation itself was skipped above).
  await embedWin32ExeResources(
    join(outDir, `${productName}.exe`),
    config,
    iconResource ? join(resourcesDir, 'icon.ico') : null,
  )

  // resources/murasaki-meta.json — same shape the macOS path writes, read by
  // the launcher binary at runtime.
  await writeFile(
    join(resourcesDir, 'murasaki-meta.json'),
    metaJson(config, productName, iconResource, cwd),
  )

  // resources/client — the Vite build output.
  await cp(resolve(cwd, 'dist/client'), join(resourcesDir, 'client'), { recursive: true })

  // resources/server — the 'use server' action registry bundle
  // (dist/server/actions.mjs), built self-contained (see build-server.ts) so
  // no project node_modules need to ship alongside it.
  await cp(resolve(cwd, 'dist/server'), join(resourcesDir, 'server'), { recursive: true })

  // Keep the Windows runtime layout equivalent to macOS: external Node
  // packages and developer resources live beside server/ under resources/.
  await stageServerDependencies(
    cwd,
    resolve(cwd, 'dist/server'),
    resourcesDir,
    config,
    { platform: 'win32', arch },
  )
  await stageBundleResources(cwd, resourcesDir, config)

  // resources/node_modules/@murasakijs/native — external native binding,
  // copied as-is since its .node binary is arch-specific and can't go
  // through esbuild/tsc (dev-only Rust artifacts filtered out).
  const nativeDest = join(resourcesDir, 'node_modules/@murasakijs/native')
  await mkdir(dirname(nativeDest), { recursive: true })
  await copyNativeModule(nativeDir, nativeDest, { platform: 'win32', arch })

  // Authenticode-sign the application-owned launcher only after PE resources
  // and every bundle payload are final, but before the portable ZIP and
  // installers consume it. The downloaded Node runtime carries its upstream
  // signature and must not be re-signed as if it were app-owned code.
  const appExecutable = join(outDir, `${productName}.exe`)
  if (shouldSign) signWindowsArtifact(appExecutable, config, cwd)

  process.stdout.write(`\n${success(`bundle written  ${dim(outDir)}`)}\n\n`)

  // dist/bundle/<productName>-win32-<arch>.zip — a no-install "portable"
  // deliverable alongside the installers (murasaki installer --target
  // win32-*, cli/installer.ts): unzip anywhere and run <productName>.exe.
  const zipPath = await zipWin32Bundle(resolve(cwd, 'dist/bundle'), productName, arch)
  process.stdout.write(`\n${success(`zip written  ${dim(zipPath)}`)}\n\n`)
  if (!shouldSign) process.stdout.write(unsignedNote(zipPath))
}

/**
 * Zips the just-staged `<bundleRoot>/<productName>/` folder into
 * `<bundleRoot>/<productName>-win32-<arch>.zip`, preserving the folder name
 * as the archive's top-level entry (so extracting it drops a
 * `<productName>/` folder containing `<productName>.exe` + `resources/`,
 * same shape as the unzipped bundle). Shells out rather than adding a zip
 * dependency: the posix `zip` CLI ships on every GitHub Actions macOS/Linux
 * runner (and this repo's dev machines), and PowerShell's `Compress-Archive`
 * ships with every Windows runner/install — between the two, this covers
 * both cross-bundling off macOS and running natively on the win32 CI runner.
 */
async function zipWin32Bundle(bundleRoot: string, productName: string, arch: Arch): Promise<string> {
  const zipPath = join(bundleRoot, `${productName}-win32-${arch}.zip`)
  await rm(zipPath, { force: true })

  // `-q` (zip) keeps stdout from growing an "adding: <file>" line per file —
  // bundles can have thousands of entries, which both spams the terminal and
  // risks overrunning spawnSync's buffered stdout; maxBuffer is also raised
  // defensively for the same reason (Compress-Archive is quiet by default,
  // no flag needed there).
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Compress-Archive -Path '${productName}' -DestinationPath '${zipPath}' -Force`,
          ],
          { cwd: bundleRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
        )
      : spawnSync('zip', ['-rq', zipPath, productName], {
          cwd: bundleRoot,
          encoding: 'utf8',
          maxBuffer: 256 * 1024 * 1024,
        })

  if (result.error || result.status !== 0) {
    throw new Error(
      `murasaki: failed to create ${zipPath}: ${(result.stderr || result.stdout || result.error?.message || '').trim()}`,
    )
  }
  return zipPath
}

/**
 * Zips the just-signed `<appDir>` (`<bundleRoot>/<productName>.app`) into
 * `<bundleRoot>/<productName>-darwin-<arch>.app.zip` — the macOS auto-update
 * payload (see `murasaki release --manifest`). Shells out to `ditto`, NOT
 * `zip`: plain `zip` doesn't round-trip the symlinks/resource forks a signed
 * `.app`'s `Contents/` relies on and corrupts the code signature applied by
 * `signApp` above, so this must run after that signing step.
 * `--sequesterRsrc --keepParent` mirrors Apple's own documented recipe for
 * zipping a bundle for distribution; the matching unzip is `ditto -x -k`
 * (the apply-helper's extraction step).
 */
async function zipDarwinApp(
  bundleRoot: string,
  productName: string,
  arch: Arch,
  appDir: string,
): Promise<string> {
  const zipPath = join(bundleRoot, `${productName}-darwin-${arch}.app.zip`)
  await rm(zipPath, { force: true })

  const result = spawnSync(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', appDir, zipPath],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      `murasaki: failed to create ${zipPath}: ${(result.stderr || result.stdout || result.error?.message || '').trim()}`,
    )
  }
  return zipPath
}

/**
 * The `murasaki-meta.json` object written into both the `.app`'s
 * `Contents/Resources/` and the win32 folder's `resources/` — read by
 * `murasaki-launcher` at runtime for window title/size, About panel fields,
 * etc., and by `prod-server.mjs` (from its cwd, the resources dir) for the
 * resolved updater config. Kept as one function so the two bundle targets
 * can't drift apart.
 */
export function metaJson(
  config: MurasakiConfig,
  productName: string,
  iconResource: string | null,
  cwd: string,
): string {
  const mainShutdownTimeoutMs = config.main === false ? undefined : config.main?.shutdownTimeoutMs
  validateMainShutdownTimeoutMs(mainShutdownTimeoutMs)
  // Resolved (not raw) so prod-server.mjs never has to re-derive the GitHub
  // manifest URL / public key / interval parsing itself — resolveUpdater()
  // throws on a broken updater config, which surfaces as a bundle failure
  // here rather than a silent runtime no-op.
  const updater = resolveUpdater(config.updater, { projectRoot: cwd })
  const associations = resolveAssociations(config)
  const windows = resolveWindowDeclarations(config).map((declaration) => ({
    label: declaration.label,
    primary: declaration.primary,
    route: declaration.route,
    visible: declaration.visible,
    title: declaration.title,
    width: declaration.width,
    height: declaration.height,
    minWidth: declaration.minWidth,
    minHeight: declaration.minHeight,
    resizable: declaration.resizable,
    transparent: declaration.transparent,
    vibrancy: declaration.vibrancy,
    capabilities: declaration.capabilities,
  }))
  const primaryWindow = windows[0]
  return JSON.stringify(
    {
      appId: config.appId,
      productName,
      version: config.version ?? '0.0.0',
      description: config.description,
      copyright: config.copyright,
      homepage: config.homepage,
      authors: config.authors,
      locales: config.locales,
      title: primaryWindow.title,
      width: primaryWindow.width,
      height: primaryWindow.height,
      minWidth: primaryWindow.minWidth,
      minHeight: primaryWindow.minHeight,
      resizable: primaryWindow.resizable,
      transparent: primaryWindow.transparent,
      capabilities: primaryWindow.capabilities,
      mainShutdownTimeoutMs,
      vibrancy: primaryWindow.vibrancy,
      console: config.window?.console,
      windows,
      icon: iconResource ?? undefined,
      protocols: associations.protocols,
      fileAssociations: associations.files,
      ...(updater ? { updater } : {}),
    },
    null,
    2,
  )
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
 * `--target <platform>-<arch>` (e.g. `win32-x64`), for cross-bundling a
 * platform other than the host. Falls back to `config.targets[0]` when
 * `--target` isn't passed, then to the host platform + `--arch`/host arch —
 * which is exactly the pre-`--target` behavior, so plain `murasaki bundle`
 * and `murasaki bundle --arch x64` on macOS are unaffected.
 *
 * Only a single target is resolved per invocation even when `config.targets`
 * lists several — building every configured target in one run is left to a
 * later pass (e.g. a loop in the `release` command); pass `--target`
 * explicitly to pick a specific one.
 */
export function parseTarget(argv: string[], config: MurasakiConfig): BundleTarget {
  const i = argv.indexOf('--target')
  if (i >= 0) return parseTargetId(argv[i + 1])
  if (config.targets && config.targets.length > 0) return parseTargetId(config.targets[0])
  return { platform: process.platform as Platform, arch: parseArch(argv) }
}

function parseTargetId(id: string | undefined): BundleTarget {
  const match = /^(darwin|win32|linux)-(arm64|x64)$/.exec(id ?? '')
  if (!match) {
    throw new Error(
      `murasaki: --target must be like "darwin-arm64", "win32-x64", or "linux-x64", got ${JSON.stringify(id)}`,
    )
  }
  return { platform: match[1] as Platform, arch: match[2] as Arch }
}

/**
 * Locate the installed `@murasakijs/native` package dir. Resolve from the user
 * project first (the normal, hoisted case), then fall back to resolving from
 * murasaki's own location — `@murasakijs/native` is murasaki's dependency, so
 * this succeeds even when a package manager nests it under
 * `node_modules/murasaki/node_modules/` (e.g. `file:`/link installs) rather
 * than hoisting it to the project root.
 */
/**
 * Vendor `@murasakijs/native` into the bundle, EXCLUDING dev-only artifacts
 * AND every native artifact (`.node` addon, `murasaki-launcher` binary) that
 * isn't built for `target`.
 *
 * A published `@murasakijs/native` tarball ships every platform/arch's
 * prebuilt binaries in the SAME package (see `resolveLauncherBinary`'s doc
 * comment) — left unfiltered, a naive recursive copy vendors all of them
 * into every bundle, e.g. a win32-x64 installer shipping a macOS
 * `murasaki-native.darwin-arm64.node`. `nativeArtifactTargetSuffix` reuses
 * `launcherFilename`'s napi-triple naming convention (rather than inventing
 * a second one) to recognize these target-suffixed filenames and skip any
 * that don't match `target`. It's fine — expected, even — for no matching
 * `.node` addon to exist for `target` (e.g. this workspace-linked dev tree
 * has no win32 addon compiled); that file is just omitted, nothing is
 * substituted in its place.
 *
 * Also strips dev-only artifacts: when the package is workspace-linked to
 * `crates/native` (dev tree, or CI that scaffolds the app inside the
 * workspace) a naive recursive copy drags in the Rust `target/` dir
 * (multi-GB) and the crate source — which would then get zipped/wrapped into
 * every installer. This filter keeps the bundle small in both cases (the
 * excluded dirs simply don't exist in a real npm install).
 */
async function copyNativeModule(
  nativeDir: string,
  dest: string,
  target: BundleTarget,
): Promise<void> {
  const EXCLUDE_DIRS = new Set(['target', 'src', 'npm', 'node_modules', '.git'])
  const triple = napiTargetTriple(target.platform, target.arch)
  await cp(nativeDir, dest, {
    recursive: true,
    filter: (src) => {
      const rel = relative(nativeDir, src)
      if (rel === '') return true
      const top = rel.split(sep)[0]
      if (EXCLUDE_DIRS.has(top)) return false
      // dev-only files at the package root (Rust/build config, not shipped)
      if (!rel.includes(sep) && /^(Cargo\.(toml|lock)|build\.rs|\.gitignore)$/.test(rel)) {
        return false
      }
      const base = rel.split(sep).pop() ?? rel
      const artifactSuffix = nativeArtifactTargetSuffix(base)
      if (artifactSuffix !== null) return artifactSuffix === triple
      return true
    },
  })
}

/**
 * The napi-rs target triple embedded in both `@murasakijs/native`'s compiled
 * `.node` addon filenames and the `murasaki-launcher` binary filenames (e.g.
 * `darwin-arm64`, `win32-x64-msvc`) — derived from `launcherFilename` itself
 * (stripping its `murasaki-launcher.` prefix and any `.exe` suffix) so
 * there's exactly one place that knows this naming convention, not two.
 */
function napiTargetTriple(platform: Platform, arch: Arch): string {
  return launcherFilename(platform, arch).replace(/^murasaki-launcher\./, '').replace(/\.exe$/, '')
}

/**
 * If `basename` is a target-suffixed native artifact — `murasaki-native.
 * <triple>.node` or `murasaki-launcher.<triple>[.exe]` — returns its triple
 * suffix (e.g. `"darwin-arm64"`, `"win32-x64-msvc"`); otherwise `null` for
 * every other file (JS, `package.json`, `.d.ts`, …), which `copyNativeModule`
 * copies unfiltered regardless of `target`.
 */
function nativeArtifactTargetSuffix(basename: string): string | null {
  if (basename.startsWith('murasaki-native.') && basename.endsWith('.node')) {
    return basename.slice('murasaki-native.'.length, -'.node'.length)
  }
  if (basename.startsWith('murasaki-launcher.')) {
    const suffix = basename.slice('murasaki-launcher.'.length)
    return suffix.endsWith('.exe') ? suffix.slice(0, -'.exe'.length) : suffix
  }
  return null
}

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
 * Locate the compiled `murasaki-launcher` binary for the target
 * platform/arch. Published `@murasakijs/native` ships prebuilt binaries
 * named `murasaki-launcher.<napi-triple>` (see
 * .github/workflows/native-release.yml and crates/native/package.json's
 * `files`), matching the `.node` bindings' `murasaki-native.<napi-triple>.node`
 * naming — this resolves correctly for cross-platform/cross-arch builds too,
 * since every triple ships in the package (confirmed against the published
 * @murasakijs/native@0.31.0 tarball, which includes
 * murasaki-launcher.win32-x64-msvc.exe alongside the darwin/linux ones).
 * Falls back to a local `cargo build --release --bin murasaki-launcher`
 * output for development, where `@murasakijs/native` resolves to a workspace
 * link to crates/native itself rather than a published package — but only
 * when platform+arch matches the host, since that output is never
 * cross-compiled.
 */
async function resolveLauncherBinary(
  nativeDir: string,
  platform: Platform,
  arch: Arch,
): Promise<string> {
  const filename = launcherFilename(platform, arch)
  const candidates = [join(nativeDir, filename)]
  if (platform === process.platform && arch === process.arch) {
    const hostExe = platform === 'win32' ? '.exe' : ''
    candidates.push(
      join(nativeDir, `target/release/murasaki-launcher${hostExe}`),
      resolve(__dirname, `../../../../crates/native/target/release/murasaki-launcher${hostExe}`),
    )
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `murasaki: launcher binary not found — @murasakijs/native must ship ${filename}; rebuild native or update @murasakijs/native.`,
  )
}

/**
 * `murasaki-launcher.<napi-triple>[.exe]` — matches how
 * .github/workflows/native-release.yml names the launcher binary it uploads
 * for each build matrix target, reading the triple straight off napi's own
 * `.node` filename (win32 triples get `-msvc`, linux `-gnu`; only win32
 * binaries get a `.exe` suffix).
 */
function launcherFilename(platform: Platform, arch: Arch): string {
  switch (platform) {
    case 'darwin':
      return `murasaki-launcher.darwin-${arch}`
    case 'win32':
      return `murasaki-launcher.win32-${arch}-msvc.exe`
    case 'linux':
      return `murasaki-launcher.linux-${arch}-gnu`
  }
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

/**
 * `config.icon` (a PNG) → `<resourcesDir>/icon.png` + `icon.ico`, for the
 * win32 bundle. The `.ico` fan-out (16/24/32/48/64/256 — the standard
 * Windows icon sizes: 16/32/48/256 cover Explorer's small/medium/large/
 * extra-large views, 24/64 the odd sizes some Windows UI still asks for) is
 * done with `pngjs` (decode + our own `resizePng` below) and `png-to-ico`
 * (re-encode as `.ico`) — both pure JS, so unlike sips/iconutil this runs
 * the same way on any host, including the Windows CI runner itself. Same
 * return contract as `buildIcon` (the macOS counterpart): the
 * meta.json-relative icon path, or `null` if `iconPath` doesn't resolve to
 * a file.
 */
async function buildWin32Icon(
  cwd: string,
  iconPath: string,
  resourcesDir: string,
): Promise<string | null> {
  const src = resolve(cwd, iconPath)
  if (!existsSync(src)) {
    process.stdout.write(`\n${warn(`icon: ${iconPath} not found, skipping`)}\n\n`)
    return null
  }
  await copyFile(src, join(resourcesDir, 'icon.png'))

  const source = PNG.sync.read(await readFile(src))
  const sizes = [16, 24, 32, 48, 64, 256]
  const ico = await pngToIco(sizes.map((size) => resizePng(source, size)))
  await writeFile(join(resourcesDir, 'icon.ico'), ico)

  return 'icon.png'
}

/**
 * Resizes a decoded RGBA `pngjs` image to `size`x`size` via bilinear
 * sampling, returning a re-encoded PNG buffer — the resize step
 * `buildWin32Icon` needs (pngjs itself only encodes/decodes, it doesn't
 * resize) to fan a single source PNG out to every `.ico` size.
 */
function resizePng(src: PNG, size: number): Buffer {
  const dst = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    const sy = Math.min(Math.max(((y + 0.5) * src.height) / size - 0.5, 0), src.height - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, src.height - 1)
    const ty = sy - y0
    for (let x = 0; x < size; x++) {
      const sx = Math.min(Math.max(((x + 0.5) * src.width) / size - 0.5, 0), src.width - 1)
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, src.width - 1)
      const tx = sx - x0
      const dstIdx = (y * size + x) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + c]
        const p10 = src.data[(y0 * src.width + x1) * 4 + c]
        const p01 = src.data[(y1 * src.width + x0) * 4 + c]
        const p11 = src.data[(y1 * src.width + x1) * 4 + c]
        const top = p00 + (p10 - p00) * tx
        const bottom = p01 + (p11 - p01) * tx
        dst.data[dstIdx + c] = Math.round(top + (bottom - top) * ty)
      }
    }
  }
  return PNG.sync.write(dst)
}

/**
 * Embeds `resources/icon.ico` + a version-info resource into the just-copied
 * `<productName>.exe`'s PE resources, using `resedit` — a pure-JS PE
 * resource editor (built on `pe-library`), so like the rest of this file's
 * win32 path it runs unmodified on macOS/Linux (cross-bundling/CI) as well
 * as a Windows runner, no rcedit/Wine needed. This is what makes Explorer,
 * the taskbar, the title bar, and the Start menu show the app's icon instead
 * of Windows' generic default — the prebuilt `murasaki-launcher.exe` ships
 * with no icon resource of its own (see `buildWin32Icon`'s doc comment).
 * No-op if `iconIcoPath` is `null` (icon generation was itself skipped, see
 * `bundleWin32`).
 */
async function embedWin32ExeResources(
  exePath: string,
  config: MurasakiConfig,
  iconIcoPath: string | null,
): Promise<void> {
  if (!iconIcoPath) return

  const exe = NtExecutable.from(await readFile(exePath))
  const res = NtExecutableResource.from(exe)

  // Icon group — language-neutral (lang 0) so it shows regardless of the end
  // user's system locale, same as most Windows resource-generation tools'
  // (rcedit, winres, Visual Studio's default .rc) default. ID 1 mirrors
  // those same tools' conventional "main icon" resource ID; the prebuilt
  // launcher has no pre-existing icon-group entry, so this is added rather
  // than replaced.
  const iconFile = Data.IconFile.from(await readFile(iconIcoPath))
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    0,
    iconFile.icons.map((item) => item.data),
  )

  // Version info — the fields Explorer's file-Properties "Details" tab (and
  // the taskbar/Alt-Tab tooltip) read. lang 1033 / codepage 1200 (en-US,
  // Unicode) is the conventional default most single-language Windows apps
  // use.
  const LANG = 1033
  const CODEPAGE = 1200
  const [major, minor, patch, rev] = parseVersionParts(config.version)
  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] ?? Resource.VersionInfo.createEmpty()
  vi.setFileVersion(major, minor, patch, rev, LANG)
  vi.setProductVersion(major, minor, patch, rev, LANG)
  vi.setStringValues(
    { lang: LANG, codepage: CODEPAGE },
    {
      ProductName: config.productName,
      FileDescription: config.description ?? config.productName,
      CompanyName: resolveWindowsPublisher(config),
      OriginalFilename: `${config.productName}.exe`,
    },
  )
  vi.outputToResourceEntries(res.entries)

  // Application manifest — RT_MANIFEST (type 24) / id 1, the well-known
  // CREATEPROCESS_MANIFEST_RESOURCE_ID that Windows reads at process-launch
  // time (independent of the resource-neutral vi/icon stuff above). The
  // prebuilt murasaki-launcher.exe ships with no manifest at all, so Windows
  // treats it as a legacy program with no declared OS compatibility — which
  // is what makes the Program Compatibility Assistant's InstallFailure
  // resolver flag it right after install ("this program might not have
  // installed correctly"). `replaceResourceEntry` adds-or-replaces by
  // type/id/lang, so this is safe even if a manifest entry already exists.
  // lang 1033 matches the version-info resource above.
  res.replaceResourceEntry({
    type: 24,
    id: 1,
    lang: 1033,
    codepage: 0,
    bin: utf8ArrayBuffer(win32AppManifest(config)),
  })

  res.outputResource(exe)
  await writeFile(exePath, Buffer.from(exe.generate()))
}

/**
 * The win32 application manifest embedded into `<productName>.exe` by
 * `embedWin32ExeResources` above (see the comment there for why). Declares
 * only `assemblyIdentity` + `trustInfo` (asInvoker, no elevation) +
 * `compatibility` (supportedOS for Vista through Windows 10/11) —
 * deliberately does *not* add a `<windowsSettings>`/`dpiAware`(`ness`)
 * declaration, since the Rust launcher (tao) already sets DPI awareness
 * programmatically at runtime; a manifest declaration would take precedence
 * and could regress multi-monitor scaling. Also omits the Common-Controls
 * `<dependency>` — kept minimal and behavior-neutral otherwise.
 */
function win32AppManifest(config: MurasakiConfig): string {
  const name = escapeXml(sanitizeAssemblyName(config.productName))
  const [major, minor, patch, rev] = parseVersionParts(config.version)
  const version = `${major}.${minor}.${patch}.${rev}`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="${name}" version="${version}" processorArchitecture="*"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{e2011457-1546-43c5-a5fe-008deee3d3f0}"/>
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"/>
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    </application>
  </compatibility>
</assembly>
`
}

/**
 * `assemblyIdentity`'s `name` attribute rejects whitespace/punctuation
 * outside `[A-Za-z0-9.]` — collapse any run of disallowed characters to a
 * single `.` (e.g. `"My App"` → `"My.App"`), falling back to a generic name
 * if that leaves nothing usable (e.g. an all-emoji productName).
 */
function sanitizeAssemblyName(productName: string): string {
  const sanitized = productName.replace(/[^A-Za-z0-9.]+/g, '.')
  return sanitized.length > 0 ? sanitized : 'MurasakiApp'
}

/** UTF-8-encodes `s` into a plain `ArrayBuffer`, as `resedit`'s raw resource `bin` field wants. */
function utf8ArrayBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer
}

/**
 * `config.version` (e.g. `"1.2.3"` or `"1.2.3-beta.1"`) → the 4-part
 * `major.minor.patch.build` tuple `resedit`'s `VersionInfo.setFileVersion`/
 * `setProductVersion` want. Non-numeric trailing text (pre-release tags, …)
 * is dropped by `parseInt`; missing/unparsable parts default to 0.
 */
function parseVersionParts(version: string | undefined): [number, number, number, number] {
  const parts = (version ?? '0.0.0').split('.').map((p) => parseInt(p, 10) || 0)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0]
}

/**
 * CompanyName for the exe's version-info resource above — mirrors
 * installer.ts's `resolveWindowsPublisher` (same priority chain: `config
 * .installer.windows.publisher`, else `authors`, else `copyright`, else
 * `productName`). Kept as its own copy here rather than a shared import so
 * this file has no dependency on installer.ts, matching the existing
 * direction of that dependency (installer.ts imports from bundle.ts, not the
 * reverse).
 */
function resolveWindowsPublisher(config: MurasakiConfig): string {
  return (
    config.installer?.windows?.publisher ??
    (config.authors && config.authors.length > 0 ? config.authors.join(', ') : undefined) ??
    config.copyright ??
    config.productName
  )
}

export function infoPlist(config: MurasakiConfig, productName: string, hasIcon: boolean): string {
  const appId = escapeXml(config.appId)
  const name = escapeXml(productName)
  const version = escapeXml(config.version ?? '0.0.0')
  const locales = config.locales ?? DEFAULT_LOCALES
  const localizationsXml = locales.map((l) => `    <string>${escapeXml(l)}</string>`).join('\n')
  const associations = resolveAssociations(config)
  const protocolsXml = associations.protocols.length === 0 ? '' : `
  <key>CFBundleURLTypes</key>
  <array>
${associations.protocols.map((protocol) => `    <dict>
      <key>CFBundleURLName</key><string>${escapeXml(`${config.appId}.url.${protocol.scheme}`)}</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>CFBundleURLSchemes</key>
      <array><string>${escapeXml(protocol.scheme)}</string></array>
    </dict>`).join('\n')}
  </array>`
  const documentTypesXml = associations.files.length === 0 ? '' : `
  <key>CFBundleDocumentTypes</key>
  <array>
${associations.files.map((file) => `    <dict>
      <key>CFBundleTypeName</key><string>${escapeXml(file.name)}</string>
      <key>CFBundleTypeRole</key><string>${macDocumentRole(file.role)}</string>
      <key>LSHandlerRank</key><string>Owner</string>
      <key>LSItemContentTypes</key>
      <array><string>${escapeXml(macTypeIdentifier(config.appId, file.extensions[0]))}</string></array>
      <key>CFBundleTypeExtensions</key>
      <array>${file.extensions.map((extension) => `<string>${escapeXml(extension)}</string>`).join('')}</array>${file.mimeType ? `
      <key>CFBundleTypeMIMETypes</key>
      <array><string>${escapeXml(file.mimeType)}</string></array>` : ''}
    </dict>`).join('\n')}
  </array>
  <key>UTExportedTypeDeclarations</key>
  <array>
${associations.files.map((file) => `    <dict>
      <key>UTTypeIdentifier</key><string>${escapeXml(macTypeIdentifier(config.appId, file.extensions[0]))}</string>
      <key>UTTypeDescription</key><string>${escapeXml(file.description)}</string>
      <key>UTTypeConformsTo</key><array><string>public.data</string></array>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array>${file.extensions.map((extension) => `<string>${escapeXml(extension)}</string>`).join('')}</array>${file.mimeType ? `
        <key>public.mime-type</key><string>${escapeXml(file.mimeType)}</string>` : ''}
      </dict>
    </dict>`).join('\n')}
  </array>`
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
  </array>${hasIcon ? '\n  <key>CFBundleIconFile</key><string>icon</string>' : ''}${protocolsXml}${documentTypesXml}
</dict>
</plist>
`
}

function macDocumentRole(role: 'viewer' | 'editor' | 'shell' | 'none'): string {
  return role[0].toUpperCase() + role.slice(1)
}

function macTypeIdentifier(appId: string, extension: string): string {
  const safeAppId = appId.toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/^-+|-+$/g, '') || 'murasaki.app'
  return `${safeAppId}.file.${extension}`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
