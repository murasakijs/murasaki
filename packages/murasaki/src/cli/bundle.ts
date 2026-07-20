import { resolve, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile, rm, cp, copyFile, chmod, readdir, readFile, symlink, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import pngToIco from 'png-to-ico'
import { PNG } from 'pngjs'
import { NtExecutable, NtExecutableResource, Data, Resource } from 'resedit'
import { buildProject } from './build.js'
import buildServer from './build-server.js'
import { dim, success, warn, unsignedNote, murasakiVersion } from './brand.js'
import { ensureNodeBinary, type NodePlatform } from './node-runtime.js'
import { buildAppImage } from './appimage.js'
import {
  resolveWebviewNetworkConfig,
  resolveStartupSystemPermissions,
  resolveDiagnosticsConfig,
  validateMainShutdownTimeoutMs,
  type MurasakiConfig,
  type MurasakiBuildTarget,
} from '../config.js'
import { serializeWindowTemplates } from './window-metadata.js'
import { resolveInitScripts } from './init-scripts.js'
import { resolveUpdater } from '../resolve-updater.js'
import { DEFAULT_LOCALES } from '../menu-i18n.js'
import {
  assertExecutableBundleResourcesDeclared,
  executableBundleResourcePaths,
  stageBundleResources,
  stageServerDependencies,
} from './server-dependencies.js'
import { resolveAssociations } from '../associations.js'
import { loadUserConfig } from './load-config.js'
import { signWindowsArtifact } from './windows-signing.js'
import { signLinuxArtifact } from './linux-signing.js'
import { preparePlugins, runPluginHooks } from '../plugin-runtime.js'

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
  const loadedConfig = await loadUserConfig(cwd)
  // Target platform+arch for the produced bundle — defaults to the host
  // platform/arch, but `--target win32-x64` (etc.) or `config.targets[0]`
  // cross-bundles a different platform from this machine. `--arch
  // arm64`/`--arch x64` (no `--target`) keeps working exactly as before for
  // the host platform, e.g. letting a single arm64 Mac also produce an Intel
  // `.app`. Drives both the fetched Node runtime and the `murasaki-launcher`
  // binary selection below.
  const target = parseTarget(argv, loadedConfig)
  const prepared = preparePlugins(loadedConfig)
  const config = prepared.config
  const hookOptions = {
    projectRoot: cwd,
    command: 'bundle' as const,
    target: `${target.platform}-${target.arch}` as MurasakiBuildTarget,
  }
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
  await runPluginHooks(prepared, 'before', hookOptions)
  if (!skipBuild || !existsSync(resolve(cwd, 'dist/client'))) await buildProject(cwd, config)
  // Always (re)built — cheap relative to the client build, and must exist
  // before packaging even if dist/client was already up to date.
  await buildServer(cwd, resolve(cwd, 'src'), config)

  // The win32 folder layout below has no macOS-only dependency (no
  // codesign/sips/iconutil/plist), so unlike the darwin path it can be
  // produced from any host — including this one, for cross-bundling / CI
  // verification off a Mac.
  if (target.platform === 'win32') {
    await bundleWin32(cwd, config, target.arch, shouldSign)
    await runPluginHooks(prepared, 'after', hookOptions)
    return
  }

  // The Linux AppDir/AppImage path below has no macOS-only dependency either
  // (same posture as win32's folder above), so it also cross-bundles from
  // any host — the only extra tool it needs is `mksquashfs` (see
  // appimage.ts), required only for the final AppImage-packing step.
  if (target.platform === 'linux') {
    await bundleLinux(cwd, config, target.arch, shouldSign)
    await runPluginHooks(prepared, 'after', hookOptions)
    return
  }

  if (process.platform !== 'darwin') {
    process.stdout.write(
      `\n${warn('bundle: a darwin .app can only be built while running on macOS (win32 targets can be cross-bundled from anywhere).')}\n\n`,
    )
    await runPluginHooks(prepared, 'after', hookOptions)
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

  // Resolve @murasakijs/native only to locate the compiled launcher binary.
  // Its legacy N-API binding is not used by the production Rust-launcher +
  // loopback-HTTP architecture and is deliberately not vendored.
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

  // Contents/Resources/.murasaki-runtime — the lifecycle runner and its
  // private logger/sidecar dependencies, preserving their compiled relative
  // imports. The directory is reserved from config.bundle.resources.
  await copyMainRuntime(resourcesDir)

  // Contents/Resources/menu-locales.json — read by the launcher binary at
  // runtime to localize the default app menu for the end user's locale (see
  // crates/native/src/launcher.rs).
  const menuLocalesSrc = resolve(__dirname, '../menu-locales.json')
  await copyFile(menuLocalesSrc, join(resourcesDir, 'menu-locales.json'))

  // Contents/Resources/Assets.car + icon.icns + icon.png. On current macOS,
  // the asset-catalog icon is the primary source: the OS owns the final mask,
  // appearances, and rendering. The .icns remains a compatibility fallback
  // for older releases and tooling that cannot read Assets.car. The PNG is a
  // runtime-readable source for tray/window APIs; the packaged macOS launcher
  // deliberately does not push it into NSApp.applicationIconImage because
  // doing so bypasses the system-rendered app icon.
  const iconResources = config.icon
    ? await buildMacIconResources(cwd, config.icon, resourcesDir)
    : null

  // Contents/Resources/murasaki-meta.json
  await writeFile(
    join(resourcesDir, 'murasaki-meta.json'),
    metaJson(config, productName, iconResources?.runtimePath ?? null, cwd),
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
  await assertExecutableBundleResourcesDeclared(resourcesDir, config)

  // Contents/Info.plist
  await writeFile(
    join(appDir, 'Contents/Info.plist'),
    infoPlist(config, productName, iconResources !== null, iconResources?.usesSystemMask ?? false),
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
    for (const executable of executableBundleResourcePaths(resourcesDir, config)) {
      adHocSignMacTarget(executable)
    }
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
  await runPluginHooks(prepared, 'after', hookOptions)
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

  // Resolve @murasakijs/native only to locate the compiled launcher binary;
  // the unused legacy N-API binding is not part of the packaged runtime.
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

  // resources/.murasaki-runtime — lifecycle runner and private dependencies.
  await copyMainRuntime(resourcesDir)

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
  await assertExecutableBundleResourcesDeclared(resourcesDir, config)

  // Authenticode-sign the application-owned launcher only after PE resources
  // and every bundle payload are final, but before the portable ZIP and
  // installers consume it. The downloaded Node runtime carries its upstream
  // signature and must not be re-signed as if it were app-owned code.
  const appExecutable = join(outDir, `${productName}.exe`)
  if (shouldSign) {
    for (const executable of executableBundleResourcePaths(resourcesDir, config)) {
      signWindowsArtifact(executable, config, cwd)
    }
    signWindowsArtifact(appExecutable, config, cwd)
  }

  process.stdout.write(`\n${success(`bundle written  ${dim(outDir)}`)}\n\n`)

  // dist/bundle/<productName>-win32-<arch>.zip — a no-install "portable"
  // deliverable alongside the installers (murasaki installer --target
  // win32-*, cli/installer.ts): unzip anywhere and run <productName>.exe.
  const zipPath = await zipWin32Bundle(resolve(cwd, 'dist/bundle'), productName, arch)
  process.stdout.write(`\n${success(`zip written  ${dim(zipPath)}`)}\n\n`)
  if (!shouldSign) process.stdout.write(unsignedNote(zipPath, 'win32'))
}

/**
 * Stage a Linux AppDir at `dist/bundle/<productName>.AppDir/` — the AppImage
 * project's standard on-disk layout (freedesktop.org's App Directory
 * convention), which doubles as the "raw folder" deliverable (mirroring the
 * win32 folder's role above) and as the input `buildAppImage` squashfs-
 * compresses into the packaged `.AppImage` below. `usr/lib/<appId>/
 * resources/` mirrors the EXACT same shape as the macOS bundle's
 * `Contents/Resources` (see the darwin path above) so `murasaki-launcher`'s
 * resource-loading code stays platform-agnostic; only the surrounding
 * AppDir/`.desktop`/icon-theme scaffolding here is Linux-specific.
 *
 * Has no macOS-only dependency (same posture as `bundleWin32`), so this can
 * run on any host, including this one for cross-bundling off a Mac — the
 * only external tool `bundle` needs for Linux is `mksquashfs`, and only for
 * the final AppImage-packing step (see appimage.ts). `shouldSign` GPG
 * detach-signs the produced `.AppImage` (see linux-signing.ts) — mirrors
 * `bundleWin32` Authenticode-signing its own produced executable.
 */
async function bundleLinux(
  cwd: string,
  config: MurasakiConfig,
  arch: Arch,
  shouldSign: boolean,
): Promise<void> {
  const productName = config.productName
  const appId = sanitizeLinuxAppId(config.appId)
  const execName = sanitizeLinuxExecName(productName)
  const appDir = resolve(cwd, 'dist/bundle', `${productName}.AppDir`)
  await rm(appDir, { recursive: true, force: true })

  const binDir = join(appDir, 'usr/bin')
  const resourcesDir = join(appDir, 'usr/lib', appId, 'resources')
  const applicationsDir = join(appDir, 'usr/share/applications')
  await mkdir(binDir, { recursive: true })
  await mkdir(resourcesDir, { recursive: true })
  await mkdir(applicationsDir, { recursive: true })

  // Resolve @murasakijs/native only to locate the compiled launcher binary;
  // the unused legacy N-API binding is not part of the packaged runtime.
  const nativeDir = resolveNativeModuleDir(cwd)

  // usr/bin/<execName> — the compiled `murasaki-launcher` Rust binary for
  // linux-<arch> (crates/native/src/bin/murasaki-launcher.rs).
  const launcherBinary = await resolveLauncherBinary(nativeDir, 'linux', arch)
  const launcherDest = join(binDir, execName)
  await copyFile(launcherBinary, launcherDest)
  await chmod(launcherDest, 0o755)

  // usr/bin/.<execName>.murasaki-appid — a plain-text sidecar recording this
  // app's sanitized appId, read by the launcher binary (launcher.rs's
  // `imp_linux::resolve_resources_dir`) to find `usr/lib/<appId>/resources`
  // relative to its own path. The launcher can't re-derive `appId` from
  // `execName` (sanitized independently, see `sanitizeLinuxExecName` vs
  // `sanitizeLinuxAppId` above, and they may differ), and can't safely assume
  // it's the only entry under `usr/lib` either — that holds inside an
  // isolated AppDir mount, but a real `.deb`-installed `/usr/lib` hosts many
  // unrelated packages' directories. Shipped as an ordinary file under
  // `usr/bin/`, so both the AppImage (squashfs) and the `.deb` (which tars up
  // this exact `usr/` tree, see installer.ts) carry it for free.
  await writeFile(join(binDir, `.${execName}.murasaki-appid`), appId)

  // resources/node — a downloaded, target-specific Node runtime (official
  // nodejs.org linux build, checksum-verified and cached under
  // ~/.murasaki/node/, see node-runtime.ts), fetched even when bundling from
  // a non-Linux host.
  const nodeSrc = await ensureNodeBinary('linux', arch, process.versions.node)
  const nodeDest = join(resourcesDir, 'node')
  await copyFile(nodeSrc, nodeDest)
  await chmod(nodeDest, 0o755)

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

  // resources/.murasaki-runtime — lifecycle runner and private dependencies.
  await copyMainRuntime(resourcesDir)

  // resources/menu-locales.json — read by the launcher binary at runtime to
  // localize the default app menu for the end user's locale.
  const menuLocalesSrc = resolve(__dirname, '../menu-locales.json')
  await copyFile(menuLocalesSrc, join(resourcesDir, 'menu-locales.json'))

  // resources/icon.png + the AppImage root icon/`.desktop` icon reference +
  // the freedesktop hicolor icon theme fan-out.
  const iconResource = config.icon
    ? await buildLinuxIcons(cwd, config.icon, resourcesDir, appDir, appId)
    : null

  // resources/murasaki-meta.json — same shape the macOS/win32 paths write.
  await writeFile(
    join(resourcesDir, 'murasaki-meta.json'),
    metaJson(config, productName, iconResource, cwd),
  )

  // resources/client — the Vite build output.
  await cp(resolve(cwd, 'dist/client'), join(resourcesDir, 'client'), { recursive: true })

  // resources/server — the 'use server' action registry bundle.
  await cp(resolve(cwd, 'dist/server'), join(resourcesDir, 'server'), { recursive: true })

  // Keep the Linux runtime layout equivalent to macOS/win32: external Node
  // packages and developer resources live beside server/ under resources/.
  await stageServerDependencies(cwd, resolve(cwd, 'dist/server'), resourcesDir, config, {
    platform: 'linux',
    arch,
  })
  await stageBundleResources(cwd, resourcesDir, config)

  // AppRun — the entry point the AppImage runtime execs at launch.
  await writeFile(join(appDir, 'AppRun'), linuxAppRunScript(execName))
  await chmod(join(appDir, 'AppRun'), 0o755)

  // <appId>.desktop — the AppImage spec requires a root copy; also installed
  // under usr/share/applications/ (the .deb ships that same tree — see
  // installer.ts's `installerLinux` — and a manually-extracted AppDir wants
  // it discoverable there too).
  const desktopEntry = linuxDesktopEntry(config, execName, appId)
  await writeFile(join(appDir, `${appId}.desktop`), desktopEntry)
  await writeFile(join(applicationsDir, `${appId}.desktop`), desktopEntry)

  // <appId>.png + .DirIcon — the AppImage spec's root icon convention.
  if (iconResource) {
    await symlink(`${appId}.png`, join(appDir, '.DirIcon'))
  }

  process.stdout.write(`\n${success(`bundle written  ${dim(appDir)}`)}\n\n`)

  // dist/bundle/<productName>-<version>-linux-<arch>.AppImage — the
  // packaged, double-clickable/executable deliverable (see appimage.ts); the
  // raw AppDir above is kept as its own artifact too, mirroring bundleWin32's
  // portable folder.
  const version = config.version ?? '0.0.0'
  const appImagePath = resolve(cwd, 'dist/bundle', `${productName}-${version}-linux-${arch}.AppImage`)
  await buildAppImage(appDir, appImagePath, arch)
  process.stdout.write(`\n${success(`AppImage written  ${dim(appImagePath)}`)}\n\n`)

  if (shouldSign) {
    signLinuxArtifact(appImagePath, config)
  } else {
    process.stdout.write(unsignedNote(appImagePath, 'linux'))
  }
}

/**
 * `<productName>` → a filesystem/shell-safe Linux executable name for
 * `usr/bin/<execName>` and the `.desktop` file's `Exec=`/`StartupWMClass=`
 * values — unlike macOS/Windows (where the launcher is invoked via a path
 * the OS bundle format itself resolves), an unquoted space in a `.desktop`
 * `Exec=` value is ambiguous per the freedesktop desktop-entry spec. Runs of
 * characters outside `[A-Za-z0-9._-]` collapse to a single `-`; falls back
 * to a generic name if that leaves nothing usable (e.g. an all-emoji
 * productName) — same convention as `sanitizeAssemblyName` below.
 */
export function sanitizeLinuxExecName(productName: string): string {
  const sanitized = productName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized.length > 0 ? sanitized : 'murasaki-app'
}

/**
 * `config.appId` → a filesystem-safe id for the filenames the fixed Linux
 * layout derives from it (`<appId>.desktop`, `<appId>.png`, `usr/lib/<appId>/
 * resources/`) — `appId` isn't validated for path-safety by config.ts (only
 * `productName`/`version` are, see `validateArtifactComponent`), so this
 * mirrors the same local sanitization `macTypeIdentifier` above already
 * applies for the same reason.
 */
export function sanitizeLinuxAppId(appId: string): string {
  const sanitized = appId.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '')
  return sanitized.length > 0 ? sanitized : 'murasaki.app'
}

/**
 * `<AppDir>/AppRun` — the entry point every AppImage type-2 runtime execs at
 * launch. Resolves the launcher binary via `$APPDIR`, the environment
 * variable the runtime sets to the mounted AppDir root before running this
 * script — NOT `dirname "$0"`, which would break once squashfs-mounted at a
 * runtime-chosen mountpoint (this is the AppImage spec's own recommended
 * idiom).
 */
export function linuxAppRunScript(execName: string): string {
  return `#!/bin/sh\nexec "$APPDIR/usr/bin/${execName}" "$@"\n`
}

/** Strips embedded newlines from a `.desktop` field value — the format has no XML/shell-style escaping and expects each key on one line. */
function desktopEscape(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

/**
 * The AppImage-required root `.desktop` file (also installed under
 * `usr/share/applications/` for the `.deb` — see installerLinux). `Comment`
 * falls back to the same `"<productName> desktop application"` text
 * associations.ts's file-association descriptions default to.
 * `Exec=<execName> %U` — the `%U` field code lets the desktop environment
 * pass an activation URL/file argument, matching `config.protocols`/
 * `fileAssociations`. `StartupWMClass=<execName>` lets the window manager
 * associate the running window with this launcher entry (taskbar
 * grouping/pinning). `MimeType` is only emitted when protocols/file
 * associations are declared: `x-scheme-handler/<scheme>` per protocol, and
 * per file association the declared `mimeType` when present, else
 * `application/x-<extension>` per extension — mirroring
 * the macOS/Windows association registration in `infoPlist`/
 * `nsisAssociationRegistry`/`wixAssociationComponents`, but the `.desktop`
 * file is the whole of Linux's declaration surface here (there's no OS-level
 * MIME database to register a custom type into at bundle time).
 */
export function linuxDesktopEntry(
  config: MurasakiConfig,
  execName: string,
  appId: string,
): string {
  const associations = resolveAssociations(config)
  const comment = config.description?.trim() || `${config.productName} desktop application`
  const lines = [
    '[Desktop Entry]',
    `Name=${desktopEscape(config.productName)}`,
    `Comment=${desktopEscape(comment)}`,
    `Exec=${execName} %U`,
    `Icon=${appId}`,
    'Type=Application',
    'Categories=Utility;',
    `StartupWMClass=${execName}`,
  ]
  const mimeTypes = [
    ...associations.protocols.map((protocol) => `x-scheme-handler/${protocol.scheme}`),
    ...associations.files.flatMap((file) =>
      file.mimeType ? [file.mimeType] : file.extensions.map((extension) => `application/x-${extension}`),
    ),
  ]
  if (mimeTypes.length > 0) {
    lines.push(`MimeType=${mimeTypes.map((type) => `${type};`).join('')}`)
  }
  return `${lines.join('\n')}\n`
}

/** The freedesktop hicolor icon theme sizes `buildLinuxIcons` fans a configured icon out to. */
const LINUX_ICON_SIZES = [16, 32, 64, 128, 256, 512]

/**
 * `config.icon` (a PNG) → `<resourcesDir>/icon.png` (runtime-readable copy,
 * parity with the macOS/win32 bundles' `icon.png`), the AppImage-required
 * root `<appDir>/<appId>.png` (256x256), and the freedesktop hicolor icon
 * theme fan-out under `<appDir>/usr/share/icons/hicolor/<size>x<size>/apps/
 * <appId>.png` — so desktop environments show a crisp icon at whatever size
 * they render it (menu, taskbar, alt-tab, …) instead of upscaling a single
 * resolution. Pure JS (pngjs decode + `resizePng`, the same bilinear resize
 * `buildWin32Icon` uses for its `.ico` fan-out below), so this runs
 * unmodified on any host, no ImageMagick/GIMP needed. Same return contract
 * as `buildIcon`/`buildWin32Icon`: the meta.json-relative icon path
 * ("icon.png"), or `null` if `iconPath` doesn't resolve to a file.
 */
async function buildLinuxIcons(
  cwd: string,
  iconPath: string,
  resourcesDir: string,
  appDir: string,
  appId: string,
): Promise<string | null> {
  const src = resolve(cwd, iconPath)
  if (!existsSync(src)) {
    process.stdout.write(`\n${warn(`icon: ${iconPath} not found, skipping`)}\n\n`)
    return null
  }
  const source = await readSquareIconPng(src, iconPath)
  await copyFile(src, join(resourcesDir, 'icon.png'))
  await writeFile(join(appDir, `${appId}.png`), resizePng(source, 256))

  for (const size of LINUX_ICON_SIZES) {
    const dir = join(appDir, 'usr/share/icons/hicolor', `${size}x${size}`, 'apps')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${appId}.png`), resizePng(source, size))
  }

  return 'icon.png'
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
 * Copy the Node Main lifecycle runtime without flattening its compiled module
 * graph. `main-runtime.js` imports sibling `launch.js` plus
 * `../main/logger.js`, `../main/sidecar.js`, and `../main/crash-reports.js`;
 * preserving that layout prevents packaged
 * apps from starting with an ERR_MODULE_NOT_FOUND after those production
 * services are enabled. `prod-server.mjs` also imports `crash-reports.js`
 * directly for its renderer crash-report endpoint. A private package
 * boundary marks the copied `.js` files as ESM.
 */
export async function copyMainRuntime(resourcesDir: string): Promise<void> {
  const root = join(resourcesDir, '.murasaki-runtime')
  const runtimeDir = join(root, 'runtime')
  const mainDir = join(root, 'main')
  await mkdir(runtimeDir, { recursive: true })
  await mkdir(mainDir, { recursive: true })
  await Promise.all([
    copyFile(
      resolve(__dirname, '../runtime/main-runtime.js'),
      join(runtimeDir, 'main-runtime.js'),
    ),
    copyFile(resolve(__dirname, '../runtime/launch.js'), join(runtimeDir, 'launch.js')),
    copyFile(resolve(__dirname, '../main/logger.js'), join(mainDir, 'logger.js')),
    copyFile(resolve(__dirname, '../main/sidecar.js'), join(mainDir, 'sidecar.js')),
    copyFile(resolve(__dirname, '../main/crash-reports.js'), join(mainDir, 'crash-reports.js')),
    writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n'),
  ])
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
  const windows = serializeWindowTemplates(config)
  const primaryWindow = windows[0]
  const webviewNetwork = resolveWebviewNetworkConfig(config)
  const initScripts = resolveInitScripts(config, cwd)
  return JSON.stringify(
    {
      appId: config.appId,
      productName,
      version: config.version ?? '0.0.0',
      // murasaki's own version, not the app's — read by crash reports (both
      // Node's and the native launcher's) for `frameworkVersion`.
      frameworkVersion: murasakiVersion(),
      diagnostics: resolveDiagnosticsConfig(config),
      description: config.description,
      copyright: config.copyright,
      homepage: config.homepage,
      authors: config.authors,
      about: config.about,
      locales: config.locales,
      title: primaryWindow.title,
      width: primaryWindow.width,
      height: primaryWindow.height,
      minWidth: primaryWindow.minWidth,
      minHeight: primaryWindow.minHeight,
      maxWidth: primaryWindow.maxWidth,
      maxHeight: primaryWindow.maxHeight,
      resizable: primaryWindow.resizable,
      transparent: primaryWindow.transparent,
      decorations: primaryWindow.decorations,
      titleBarStyle: primaryWindow.titleBarStyle,
      fullscreen: primaryWindow.fullscreen,
      capabilities: primaryWindow.capabilities,
      capabilityPolicy: primaryWindow.capabilityPolicy,
      systemPermissionsOnLaunch: resolveStartupSystemPermissions(config),
      webview: webviewNetwork
        ? { ...webviewNetwork, ...(initScripts.length > 0 ? { initScripts } : {}) }
        : undefined,
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

  try {
    // Sign inner code first, then the outer bundle. Every executable gets an
    // explicit target-appropriate entitlement set; `--deep` is never used to
    // sign and accidentally propagate the main app's privileges.
    const resourcesDir = join(appDir, 'Contents/Resources')
    const nodeBin = join(resourcesDir, 'node')
    if (existsSync(nodeBin)) signMacTarget(nodeBin, identity, entitlements.helper)
    for (const executable of executableBundleResourcePaths(resourcesDir, config)) {
      signMacTarget(executable, identity)
    }
    for (const addon of await findNodeAddons(resourcesDir)) {
      // A native library inherits its loading process's sandbox. Executable
      // entitlements on a `.node` add-on are unnecessary and confusing.
      signMacTarget(addon, identity)
    }
    // Signing the outer bundle signs its main executable. Signing that binary
    // once separately and then again through the bundle is redundant.
    signMacTarget(appDir, identity, entitlements.app)

    // `--deep` is appropriate for verification (not signing): validate every
    // nested binary sealed above before the bundle is distributed.
    const verify = spawnSync(
      'codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', appDir],
      { encoding: 'utf8' },
    )
    if (verify.status !== 0) {
      throw new Error(`murasaki: codesign --verify --deep --strict failed:\n${verify.stderr.trim()}`)
    }

    // Gatekeeper legitimately rejects a signed but not-yet-notarized build.
    const spctl = spawnSync('spctl', ['-a', '-vv', appDir], { encoding: 'utf8' })
    process.stdout.write(`\n${dim((spctl.stderr || spctl.stdout).trim())}\n`)

    process.stdout.write(`\n${success(`signed with ${dim(identity)}`)}\n`)
  } finally {
    await entitlements.cleanup()
  }
}

function signMacTarget(target: string, identity: string, entitlements?: string): void {
  const entitlementArgs = entitlements ? ['--entitlements', entitlements] : []
  const result = spawnSync(
    'codesign',
    [
      '--force',
      '--options',
      'runtime',
      '--timestamp',
      ...entitlementArgs,
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

function adHocSignMacTarget(target: string): void {
  const result = spawnSync('codesign', ['--force', '--sign', '-', target], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `murasaki: ad-hoc codesign failed for executable bundle resource ${target}:\n${result.stderr.trim()}`,
    )
  }
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

type ResolvedEntitlements = {
  app: string
  helper: string
  cleanup: () => Promise<void>
}

type CustomEntitlements = {
  path: string
  values: Record<string, unknown>
}

/** Resolve independent entitlement files for the main app and Node helper. */
async function resolveEntitlements(config: MurasakiConfig): Promise<ResolvedEntitlements> {
  const customApp = await resolveCustomEntitlements(config.sign?.entitlements, 'sign.entitlements')
  const customHelper = await resolveCustomEntitlements(
    config.sign?.helperEntitlements,
    'sign.helperEntitlements',
  )
  if (customApp) {
    const fileIsSandboxed = customApp.values['com.apple.security.app-sandbox'] === true
    if (fileIsSandboxed) {
      throw new Error(
        'murasaki: sign.entitlements may not enable App Sandbox; the current bundled-Node architecture does not support it',
      )
    }
  }
  if (customHelper) validateCustomHelperEntitlements(customHelper.values)
  let tempDir: string | undefined
  const generatedPath = async (name: string, contents: string): Promise<string> => {
    tempDir ??= await mkdtemp(join(tmpdir(), 'murasaki-entitlements-'))
    const path = join(tempDir, name)
    await writeFile(path, contents, { mode: 0o600 })
    return path
  }

  try {
    const app = customApp?.path ?? await generatedPath('app.entitlements', entitlementsPlist(config))
    const helper = customHelper?.path
      ?? await generatedPath('node-helper.entitlements', helperEntitlementsPlist(config))
    return {
      app,
      helper,
      cleanup: async () => {
        if (tempDir) await rm(tempDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    throw error
  }
}

/** A configured entitlement path must be a real, valid plist. */
async function resolveCustomEntitlements(
  configuredPath: string | undefined,
  field: string,
): Promise<CustomEntitlements | undefined> {
  if (!configuredPath) return undefined
  const path = resolve(process.cwd(), configuredPath)
  let details
  try {
    details = await stat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`murasaki: ${field} does not exist: ${path}`)
    }
    throw error
  }
  if (!details.isFile()) throw new Error(`murasaki: ${field} must point to a file: ${path}`)

  const lint = spawnSync('plutil', ['-lint', '--', path], { encoding: 'utf8' })
  if (lint.status !== 0) {
    throw new Error(`murasaki: ${field} is not a valid plist: ${path}\n${lint.stderr.trim()}`)
  }
  const converted = spawnSync('plutil', ['-convert', 'json', '-o', '-', '--', path], {
    encoding: 'utf8',
  })
  if (converted.status !== 0) {
    throw new Error(`murasaki: ${field} could not be read: ${path}\n${converted.stderr.trim()}`)
  }
  let values: unknown
  try {
    values = JSON.parse(converted.stdout)
  } catch {
    throw new Error(`murasaki: ${field} did not convert to a plist dictionary: ${path}`)
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error(`murasaki: ${field} must contain a plist dictionary: ${path}`)
  }
  return { path, values: values as Record<string, unknown> }
}

const NODE_HELPER_ENTITLEMENTS = new Set([
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
])

function validateCustomHelperEntitlements(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!NODE_HELPER_ENTITLEMENTS.has(key)) {
      throw new Error(
        `murasaki: sign.helperEntitlements may not grant host right ${JSON.stringify(key)}; `
          + 'only Node JIT/library-loading hardened-runtime rights are supported',
      )
    }
    if (value !== true) {
      throw new Error(`murasaki: sign.helperEntitlements ${JSON.stringify(key)} must be true`)
    }
  }
}

/**
 * Builds the main app executable's entitlement plist. This deliberately does
 * not include Node's JIT/library-loading rights; those belong only to the
 * bundled helper returned by `helperEntitlementsPlist`.
 *
 * Hardened Runtime blocks protected resources unless the main executable has
 * the matching resource-access entitlement. These are independent from the
 * Info.plist purpose strings that cause the TCC consent prompt: signed builds
 * need both. Bluetooth and speech recognition have purpose strings but no
 * Hardened Runtime resource-access entitlement; the Bluetooth entitlement is
 * App-Sandbox-only.
 * App Sandbox is deliberately not generated here. The current bundled Node
 * process needs JIT rights that are incompatible with Apple's inherit-only
 * sandbox helper model; configuration validation and this lower-level helper
 * both reject attempts to enable it.
 */
export function entitlementsPlist(config: MurasakiConfig): string {
  if (config.sign?.appSandbox === true) {
    throw new Error('murasaki: App Sandbox is unsupported by the bundled-Node architecture')
  }
  const declared = new Set(Object.keys(config.systemPermissions?.macOS ?? {}))

  const resourceEntitlements = new Map<string, string>([
    ['camera', 'com.apple.security.device.camera'],
    ['microphone', 'com.apple.security.device.audio-input'],
    ['location', 'com.apple.security.personal-information.location'],
    ['photos', 'com.apple.security.personal-information.photos-library'],
    ['contacts', 'com.apple.security.personal-information.addressbook'],
    ['calendar', 'com.apple.security.personal-information.calendars'],
    // EventKit uses the same protected store/entitlement for reminders.
    ['reminders', 'com.apple.security.personal-information.calendars'],
    ['appleEvents', 'com.apple.security.automation.apple-events'],
  ])
  const entries: string[] = []
  const emitted = new Set<string>()
  for (const [permission, entitlement] of resourceEntitlements) {
    if (declared.has(permission) && !emitted.has(entitlement)) {
      entries.push(`<key>${entitlement}</key><true/>`)
      emitted.add(entitlement)
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries.map((entry) => `  ${entry}`).join('\n')}
</dict>
</plist>
`
}

/**
 * Builds the bundled Node helper's hardened-runtime entitlement plist. JIT
 * rights remain confined to Node; App Sandbox/inherit is rejected fail-closed.
 */
export function helperEntitlementsPlist(config: MurasakiConfig): string {
  if (config.sign?.appSandbox === true) {
    throw new Error('murasaki: App Sandbox is unsupported by the bundled-Node architecture')
  }
  const entries = [
    '<key>com.apple.security.cs.allow-jit</key><true/>',
    '<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>',
    '<key>com.apple.security.cs.disable-library-validation</key><true/>',
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries.map((entry) => `  ${entry}`).join('\n')}
</dict>
</plist>
`
}

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
 * since the published package carries every supported launcher triple.
 * In workspace development, where `@murasakijs/native` resolves to the Rust
 * crate itself, refreshes the local release launcher when its Rust sources
 * are newer than the binary. This prevents a freshly-added framework
 * capability from being accepted by TypeScript/config generation but
 * rejected by a stale bundled host. Published packages contain no Cargo
 * source tree and always use their immutable target-specific prebuild.
 */
export async function resolveLauncherBinary(
  nativeDir: string,
  platform: Platform,
  arch: Arch,
): Promise<string> {
  nativeDir = resolve(nativeDir)
  const filename = launcherFilename(platform, arch)
  const packagedLauncher = join(nativeDir, filename)
  const candidates: string[] = []
  if (platform === process.platform && arch === process.arch) {
    const hostExe = platform === 'win32' ? '.exe' : ''
    const workspaceLauncher = join(nativeDir, `target/release/murasaki-launcher${hostExe}`)
    if (await workspaceLauncherNeedsRebuild(nativeDir, workspaceLauncher)) {
      rebuildWorkspaceLauncher(nativeDir, workspaceLauncher)
    }
    // A workspace build is derived from the current source and must take
    // precedence over any checked-in prebuild at the crate root.
    if (existsSync(workspaceLauncher)) candidates.push(workspaceLauncher)
    candidates.push(resolve(__dirname, `../../../../crates/native/target/release/murasaki-launcher${hostExe}`))
  } else if (
    existsSync(packagedLauncher)
    && await workspaceLauncherNeedsRebuild(nativeDir, packagedLauncher)
  ) {
    throw new Error(
      `murasaki: ${filename} is older than the workspace Rust sources. ` +
      `Rebuild the ${platform}-${arch} native prebuild before cross-bundling; ` +
      'Murasaki will not package a capability-incompatible launcher.',
    )
  }
  candidates.push(packagedLauncher)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `murasaki: launcher binary not found — @murasakijs/native must ship ${filename}; rebuild native or update @murasakijs/native.`,
  )
}

/** True only for a workspace-linked native crate whose launcher is missing or stale. */
export async function workspaceLauncherNeedsRebuild(
  nativeDir: string,
  launcherPath: string,
): Promise<boolean> {
  const manifest = join(nativeDir, 'Cargo.toml')
  const srcDir = join(nativeDir, 'src')
  if (!existsSync(manifest) || !existsSync(srcDir)) return false
  if (!existsSync(launcherPath)) return true

  const launcherMtime = (await stat(launcherPath)).mtimeMs
  return (await newestSourceMtime([manifest, join(nativeDir, 'build.rs'), srcDir])) > launcherMtime
}

function rebuildWorkspaceLauncher(nativeDir: string, launcherPath: string): void {
  process.stdout.write(`  ${dim('native host')}  rebuilding stale workspace launcher\n`)
  const result = spawnSync(
    'cargo',
    ['build', '--release', '--bin', 'murasaki-launcher', '--manifest-path', join(nativeDir, 'Cargo.toml')],
    { cwd: nativeDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  if (result.error || result.status !== 0 || !existsSync(launcherPath)) {
    const detail = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()]
      .filter(Boolean)
      .join('\n')
    throw new Error(
      'murasaki: the workspace native launcher is older than its Rust sources and could not be rebuilt.' +
      (detail ? `\n${detail}` : ''),
    )
  }
}

async function newestSourceMtime(paths: string[]): Promise<number> {
  let newest = 0
  for (const path of paths) {
    if (!existsSync(path)) continue
    const info = await stat(path)
    newest = Math.max(newest, info.mtimeMs)
    if (!info.isDirectory()) continue
    const children = await readdir(path)
    newest = Math.max(newest, await newestSourceMtime(children.map((child) => join(path, child))))
  }
  return newest
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
 * `config.icon` (a 1024px PNG) → a current macOS AppIcon asset catalog plus
 * `<resourcesDir>/icon.icns` + `icon.png` compatibility resources.
 *
 * Xcode's `actool` is the only supported writer for Assets.car. When a full
 * Xcode installation is available we compile AppIcon into Assets.car and let
 * macOS apply its platform mask. Command Line Tools alone only provide
 * `sips`/`iconutil`, so that environment receives a clear warning and the
 * legacy `.icns` fallback instead of silently pretending system masking is
 * active.
 */
type MacIconResources = {
  runtimePath: 'icon.png'
  usesSystemMask: boolean
}

export async function buildMacIconResources(
  cwd: string,
  iconPath: string,
  resourcesDir: string,
): Promise<MacIconResources | null> {
  const src = resolve(cwd, iconPath)
  if (!existsSync(src)) {
    process.stdout.write(`\n${warn(`icon: ${iconPath} not found, skipping`)}\n\n`)
    return null
  }
  await readSquareIconPng(src, iconPath)

  // iconutil requires the source directory itself to end in `.iconset`.
  const tmpRoot = await mkdtemp(join(tmpdir(), 'murasaki-icon-'))
  const iset = join(tmpRoot, 'icon.iconset')
  const assetCatalog = join(tmpRoot, 'MurasakiAssets.xcassets')
  const appIconSet = join(assetCatalog, 'AppIcon.appiconset')
  await mkdir(iset)
  await mkdir(appIconSet, { recursive: true })
  let usesSystemMask = false
  try {
    const entries: Array<{ name: string; pixels: number; size: string; scale: '1x' | '2x' }> = [
      { name: 'icon_16x16.png', pixels: 16, size: '16x16', scale: '1x' },
      { name: 'icon_16x16@2x.png', pixels: 32, size: '16x16', scale: '2x' },
      { name: 'icon_32x32.png', pixels: 32, size: '32x32', scale: '1x' },
      { name: 'icon_32x32@2x.png', pixels: 64, size: '32x32', scale: '2x' },
      { name: 'icon_128x128.png', pixels: 128, size: '128x128', scale: '1x' },
      { name: 'icon_128x128@2x.png', pixels: 256, size: '128x128', scale: '2x' },
      { name: 'icon_256x256.png', pixels: 256, size: '256x256', scale: '1x' },
      { name: 'icon_256x256@2x.png', pixels: 512, size: '256x256', scale: '2x' },
      { name: 'icon_512x512.png', pixels: 512, size: '512x512', scale: '1x' },
      { name: 'icon_512x512@2x.png', pixels: 1024, size: '512x512', scale: '2x' },
    ]
    for (const entry of entries) {
      const generated = join(iset, entry.name)
      const resize = spawnSync(
        'sips',
        ['-z', String(entry.pixels), String(entry.pixels), src, '--out', generated],
        { encoding: 'utf8' },
      )
      if (resize.status !== 0) {
        throw new Error(`murasaki: sips failed while generating ${entry.name}:\n${resize.stderr.trim()}`)
      }
      await copyFile(generated, join(appIconSet, entry.name))
    }
    const iconutil = spawnSync(
      'iconutil',
      ['-c', 'icns', iset, '-o', join(resourcesDir, 'icon.icns')],
      { encoding: 'utf8' },
    )
    if (iconutil.status !== 0) {
      throw new Error(`murasaki: iconutil failed:\n${iconutil.stderr.trim()}`)
    }

    await writeFile(
      join(appIconSet, 'Contents.json'),
      `${JSON.stringify({
        images: entries.map((entry) => ({
          filename: entry.name,
          idiom: 'mac',
          scale: entry.scale,
          size: entry.size,
        })),
        info: { author: 'murasaki', version: 1 },
      }, null, 2)}\n`,
    )

    const developerDir = await resolveActoolDeveloperDir()
    if (developerDir) {
      const partialPlist = join(tmpRoot, 'asset-catalog-info.plist')
      const actool = spawnSync(
        '/usr/bin/xcrun',
        [
          'actool',
          '--compile', resourcesDir,
          '--platform', 'macosx',
          '--target-device', 'mac',
          '--minimum-deployment-target', '11.0',
          '--app-icon', 'AppIcon',
          '--standalone-icon-behavior', 'none',
          '--output-partial-info-plist', partialPlist,
          '--warnings',
          '--errors',
          assetCatalog,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, DEVELOPER_DIR: developerDir },
        },
      )
      usesSystemMask = actool.status === 0 && existsSync(join(resourcesDir, 'Assets.car'))
      if (!usesSystemMask) {
        const detail = [actool.stdout, actool.stderr].filter(Boolean).join('\n').trim()
        process.stdout.write(
          `\n${warn(`icon: actool could not compile the system-rendered AppIcon; using legacy icon.icns.${detail ? `\n${detail}` : ''}`)}\n\n`,
        )
      }
    } else {
      process.stdout.write(
        `\n${warn('icon: full Xcode was not found; using legacy icon.icns. Install Xcode to let macOS apply the current system AppIcon mask.')}\n\n`,
      )
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }

  // Runtime-readable source for tray/window APIs. The packaged launcher must
  // not set this as NSApp.applicationIconImage: that would replace the
  // system-rendered AppIcon with this raw square bitmap.
  await copyFile(src, join(resourcesDir, 'icon.png'))

  return { runtimePath: 'icon.png', usesSystemMask }
}

/**
 * Create a tiny icon-only application bundle for the unbundled macOS dev
 * host. `NSApp.applicationIconImage = NSImage(contentsOfFile: rawPng)` skips
 * AppIcon rendering and exposes an opaque square in the Dock. Resolving this
 * bundle through `NSWorkspace.iconForFile` gives the same system-owned mask
 * and appearance treatment as a packaged application, without modifying the
 * developer's source artwork.
 *
 * The directory intentionally lives under the OS temp directory for the
 * duration of the dev process. It contains no runnable application code; the
 * placeholder executable only makes the icon carrier a structurally valid
 * bundle for LaunchServices.
 */
export async function buildMacDevIconBundle(
  cwd: string,
  config: MurasakiConfig,
): Promise<string | null> {
  if (process.platform !== 'darwin' || !config.icon) return null

  const tmpRoot = await mkdtemp(join(tmpdir(), 'murasaki-dev-icon-'))
  const appDir = join(tmpRoot, `${config.productName}.app`)
  const contentsDir = join(appDir, 'Contents')
  const resourcesDir = join(contentsDir, 'Resources')
  const executableDir = join(contentsDir, 'MacOS')
  await mkdir(resourcesDir, { recursive: true })
  await mkdir(executableDir, { recursive: true })

  try {
    const icon = await buildMacIconResources(cwd, config.icon, resourcesDir)
    if (!icon) {
      await rm(tmpRoot, { recursive: true, force: true })
      return null
    }

    const executable = join(executableDir, config.productName)
    await writeFile(executable, '#!/bin/sh\nexit 0\n')
    await chmod(executable, 0o755)
    await writeFile(
      join(contentsDir, 'Info.plist'),
      infoPlist(
        { ...config, appId: `${config.appId}.murasaki-dev-icon` },
        config.productName,
        true,
        icon.usesSystemMask,
      ),
    )
    return appDir
  } catch (error) {
    await rm(tmpRoot, { recursive: true, force: true })
    throw error
  }
}

async function resolveActoolDeveloperDir(): Promise<string | null> {
  const candidates = new Set<string>()
  if (process.env.DEVELOPER_DIR) candidates.add(process.env.DEVELOPER_DIR)

  const selected = spawnSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8' })
  if (selected.status === 0 && selected.stdout.trim()) candidates.add(selected.stdout.trim())

  if (existsSync('/Applications')) {
    for (const entry of await readdir('/Applications')) {
      if (/^Xcode(?:[-_ ].*)?\.app$/i.test(entry)) {
        candidates.add(join('/Applications', entry, 'Contents/Developer'))
      }
    }
  }

  for (const developerDir of candidates) {
    const found = spawnSync('/usr/bin/xcrun', ['--find', 'actool'], {
      encoding: 'utf8',
      env: { ...process.env, DEVELOPER_DIR: developerDir },
    })
    if (found.status === 0 && found.stdout.trim()) return developerDir
  }
  return null
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
  const source = await readSquareIconPng(src, iconPath)
  await copyFile(src, join(resourcesDir, 'icon.png'))
  const sizes = [16, 24, 32, 48, 64, 256]
  const ico = await pngToIco(sizes.map((size) => resizePng(source, size)))
  await writeFile(join(resourcesDir, 'icon.ico'), ico)

  return 'icon.png'
}

async function readSquareIconPng(src: string, configuredPath: string): Promise<PNG> {
  let source: PNG
  try {
    source = PNG.sync.read(await readFile(src))
  } catch (error) {
    throw new Error(
      `murasaki: icon must be a valid PNG (${configuredPath}): ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (source.width !== source.height) {
    throw new Error(
      `murasaki: icon must be square; ${configuredPath} is ${source.width}x${source.height}. ` +
        'Use a dedicated square app-icon source rather than a screenshot or banner.',
    )
  }
  if (source.width < 512) {
    process.stdout.write(
      `\n${warn(`icon: ${configuredPath} is only ${source.width}px; use a 1024px source for crisp platform assets.`)}\n\n`,
    )
  }
  return source
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

export function infoPlist(
  config: MurasakiConfig,
  productName: string,
  hasIcon: boolean,
  hasSystemMaskedIcon = false,
): string {
  const appId = escapeXml(config.appId)
  const name = escapeXml(productName)
  const version = escapeXml(config.version ?? '0.0.0')
  const locales = config.locales ?? DEFAULT_LOCALES
  const localizationsXml = locales.map((l) => `    <string>${escapeXml(l)}</string>`).join('\n')
  const associations = resolveAssociations(config)
  const macOSPermissions = config.systemPermissions?.macOS
  const cameraUsageDescription = macOSPermissions?.camera?.usageDescription
  const microphoneUsageDescription = macOSPermissions?.microphone?.usageDescription
  const location = macOSPermissions?.location
  const photosUsageDescription = macOSPermissions?.photos?.usageDescription
  const contactsUsageDescription = macOSPermissions?.contacts?.usageDescription
  const calendarUsageDescription = macOSPermissions?.calendar?.usageDescription
  const remindersUsageDescription = macOSPermissions?.reminders?.usageDescription
  const speechRecognitionUsageDescription = macOSPermissions?.speechRecognition?.usageDescription
  const bluetoothUsageDescription = macOSPermissions?.bluetooth?.usageDescription
  const appleEventsUsageDescription = macOSPermissions?.appleEvents?.usageDescription
  const localNetworkUsageDescription = macOSPermissions?.localNetwork?.usageDescription
  const permissionUsageXml = [
    cameraUsageDescription
      ? `\n  <key>NSCameraUsageDescription</key><string>${escapeXml(cameraUsageDescription)}</string>`
      : '',
    microphoneUsageDescription
      ? `\n  <key>NSMicrophoneUsageDescription</key><string>${escapeXml(microphoneUsageDescription)}</string>`
      : '',
    location
      ? `\n  <key>NSLocationWhenInUseUsageDescription</key><string>${escapeXml(location.usageDescription)}</string>`
      : '',
    // Apple requires the when-in-use key present even for an 'always' request.
    location?.mode === 'always'
      ? `\n  <key>NSLocationAlwaysAndWhenInUseUsageDescription</key><string>${escapeXml(location.usageDescription)}</string>`
      : '',
    photosUsageDescription
      ? `\n  <key>NSPhotoLibraryUsageDescription</key><string>${escapeXml(photosUsageDescription)}</string>`
      : '',
    contactsUsageDescription
      ? `\n  <key>NSContactsUsageDescription</key><string>${escapeXml(contactsUsageDescription)}</string>`
      : '',
    // Both keys are written unconditionally (not gated by a config flag, unlike
    // location's 'always' mode): a packaged app is a single build that may run
    // on macOS 11 through 14+, and the native host's launch-time request picks
    // whichever EventKit API the RUNNING system supports — see
    // system_permission.rs's `ek_supports_full_access`.
    calendarUsageDescription
      ? `\n  <key>NSCalendarsUsageDescription</key><string>${escapeXml(calendarUsageDescription)}</string>\n  <key>NSCalendarsFullAccessUsageDescription</key><string>${escapeXml(calendarUsageDescription)}</string>`
      : '',
    remindersUsageDescription
      ? `\n  <key>NSRemindersUsageDescription</key><string>${escapeXml(remindersUsageDescription)}</string>\n  <key>NSRemindersFullAccessUsageDescription</key><string>${escapeXml(remindersUsageDescription)}</string>`
      : '',
    speechRecognitionUsageDescription
      ? `\n  <key>NSSpeechRecognitionUsageDescription</key><string>${escapeXml(speechRecognitionUsageDescription)}</string>`
      : '',
    bluetoothUsageDescription
      ? `\n  <key>NSBluetoothAlwaysUsageDescription</key><string>${escapeXml(bluetoothUsageDescription)}</string>`
      : '',
    appleEventsUsageDescription
      ? `\n  <key>NSAppleEventsUsageDescription</key><string>${escapeXml(appleEventsUsageDescription)}</string>`
      : '',
    localNetworkUsageDescription
      ? `\n  <key>NSLocalNetworkUsageDescription</key><string>${escapeXml(localNetworkUsageDescription)}</string>`
      : '',
  ].join('')
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
  </array>${hasIcon ? '\n  <key>CFBundleIconFile</key><string>icon</string>' : ''}${hasSystemMaskedIcon ? '\n  <key>CFBundleIconName</key><string>AppIcon</string>' : ''}${permissionUsageXml}${protocolsXml}${documentTypesXml}
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
