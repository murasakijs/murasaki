import { resolve, join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, cp, copyFile, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { success, warn, error, dim, unsignedNote } from './brand.js'
import bundle, { parseTarget, type Arch } from './bundle.js'
import type { MurasakiConfig } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DEFAULT_WINDOW = { width: 640, height: 420 }
const DEFAULT_ICON_SIZE = 128

/**
 * Produce a distributable installer for `--target <platform>-<arch>` (reuses
 * `bundle`'s `--target` parsing — see bundle.ts's `parseTarget`), defaulting
 * to the host platform/`config.targets[0]` the same way `bundle` does. Routes
 * to the darwin `.dmg` path (below) or the win32 NSIS/MSI path
 * (`installerWin32`); any other target prints a "not supported yet" notice
 * and returns, same UX as `bundle`'s unsupported-target handling.
 */
export default async function installer(argv: string[]) {
  const cwd = process.cwd()
  const config = await loadUserConfig(cwd)
  const target = parseTarget(argv, config)

  if (target.platform === 'win32') {
    await installerWin32(argv, cwd, config, target.arch)
    return
  }

  if (target.platform !== 'darwin') {
    process.stdout.write(`\n${warn(`installer: ${target.platform} is not supported yet.`)}\n\n`)
    return
  }

  if (process.platform !== 'darwin') {
    process.stdout.write(
      `\n${warn('installer: a .dmg can only be built while running on macOS (win32 targets can be built from any host with makensis/wix installed).')}\n\n`,
    )
    return
  }

  // `--sign` is parsed (and applied) by `bundle` itself — argv is forwarded
  // as-is below. `--notarize` only makes sense on top of a Developer
  // ID-signed build, so it requires `--sign` alongside it.
  const shouldSign = argv.includes('--sign')
  const shouldNotarize = argv.includes('--notarize')
  if (shouldNotarize && !shouldSign) {
    throw new Error(
      'murasaki: --notarize requires --sign (notarization only accepts Developer ID-signed ' +
        'code) — run `murasaki installer --sign --notarize`.',
    )
  }

  const productName = config.productName
  const version = config.version ?? '0.0.0'
  const appDir = resolve(cwd, 'dist/bundle', `${productName}.app`)
  // Re-bundle every time by default so the DMG never ships a stale `.app` from
  // an earlier run. `--no-build` reuses an existing bundle (and propagates to
  // `bundle`, which then also skips the client rebuild).
  const skipBuild = argv.includes('--no-build')
  if (!skipBuild || !existsSync(appDir)) await bundle(argv)

  const dmgPath = resolve(cwd, 'dist', `${productName}-${version}.dmg`)
  await rm(dmgPath, { force: true })

  const staging = await mkdtemp(join(tmpdir(), 'murasaki-dmg-'))
  try {
    await cp(appDir, join(staging, `${productName}.app`), { recursive: true })
    // Drag-to-install affordance: a symlink to /Applications sitting next
    // to the .app inside the mounted volume.
    await symlink('/Applications', join(staging, 'Applications'))

    const styled = await tryStyledDmg({ cwd, config, productName, staging, dmgPath })
    if (!styled) await plainDmg(staging, productName, dmgPath)

    process.stdout.write(`\n${success(`installer written  ${dim(dmgPath)}`)}\n\n`)

    if (shouldNotarize) {
      await notarizeDmg(dmgPath)
    } else if (!shouldSign) {
      process.stdout.write(unsignedNote(dmgPath))
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * The styled path: stage a `.background/` folder, build a read-write DMG,
 * mount it, drive Finder via `osascript` to set the window chrome/icon
 * layout, unmount, then compress to the final read-only DMG at `dmgPath`.
 * Returns `false` (instead of throwing) on any failure so the caller can
 * fall back to a plain DMG.
 */
async function tryStyledDmg(opts: {
  cwd: string
  config: MurasakiConfig
  productName: string
  staging: string
  dmgPath: string
}): Promise<boolean> {
  const { cwd, config, productName, staging, dmgPath } = opts
  const window = config.installer?.window ?? DEFAULT_WINDOW
  const iconSize = config.installer?.iconSize ?? DEFAULT_ICON_SIZE

  const rwDir = await mkdtemp(join(tmpdir(), 'murasaki-dmg-rw-'))
  const rwDmgPath = join(rwDir, `${productName}.dmg`)
  let mountPoint: string | null = null

  try {
    await stageBackground(staging, cwd, config)

    const create = spawnSync(
      'hdiutil',
      [
        'create',
        '-volname', productName,
        '-srcfolder', staging,
        '-fs', 'HFS+',
        '-format', 'UDRW',
        '-ov',
        rwDmgPath,
      ],
      { encoding: 'utf8' },
    )
    if (create.status !== 0) throw new Error(`hdiutil create failed: ${create.stderr}`)

    const attach = spawnSync(
      'hdiutil',
      ['attach', rwDmgPath, '-readwrite', '-noverify', '-noautoopen'],
      { encoding: 'utf8' },
    )
    if (attach.status !== 0) throw new Error(`hdiutil attach failed: ${attach.stderr}`)
    mountPoint = parseMountPoint(attach.stdout)
    if (!mountPoint) throw new Error('could not determine DMG mount point')

    // Give Finder a beat to notice the freshly mounted volume before we
    // start driving it.
    await delay(500)
    await styleVolume(productName, window, iconSize)

    await detachVolume(mountPoint)
    mountPoint = null

    await rm(dmgPath, { force: true })
    const convert = spawnSync(
      'hdiutil',
      ['convert', rwDmgPath, '-format', 'UDZO', '-o', dmgPath],
      { encoding: 'utf8' },
    )
    if (convert.status !== 0) throw new Error(`hdiutil convert failed: ${convert.stderr}`)

    return true
  } catch (err: any) {
    process.stdout.write(
      `\n${warn(`installer: styled DMG failed (${String(err?.message ?? err).trim()}), falling back to a plain DMG`)}\n` +
        `${dim('  ↳ the styled window needs permission to control Finder — grant it in')}\n` +
        `${dim('    System Settings ▸ Privacy & Security ▸ Automation, then re-run.')}\n`,
    )
    if (mountPoint) {
      try {
        await detachVolume(mountPoint)
      } catch {
        // best-effort — the rw staging dir gets removed below regardless.
      }
    }
    return false
  } finally {
    await rm(rwDir, { recursive: true, force: true })
  }
}

/**
 * Copy the DMG background (custom, if configured, else murasaki's default)
 * into `<staging>/.background/` as `background.png` + `background@2x.png` —
 * Finder picks the @2x variant on Retina displays automatically as long as
 * both live alongside each other under that naming convention.
 */
async function stageBackground(staging: string, cwd: string, config: MurasakiConfig) {
  const bgDir = join(staging, '.background')
  await mkdir(bgDir, { recursive: true })

  const customBgConfig = config.installer?.background
  const customBg = customBgConfig ? resolve(cwd, customBgConfig) : null

  if (customBg) {
    if (existsSync(customBg)) {
      await copyFile(customBg, join(bgDir, 'background.png'))
      await copyFile(customBg, join(bgDir, 'background@2x.png'))
      return
    }
    process.stdout.write(
      `\n${warn(`installer: background ${customBgConfig} not found, using the default`)}\n`,
    )
  }

  await copyFile(
    resolve(__dirname, '../../assets/dmg-background.png'),
    join(bgDir, 'background.png'),
  )
  await copyFile(
    resolve(__dirname, '../../assets/dmg-background@2x.png'),
    join(bgDir, 'background@2x.png'),
  )
}

/**
 * Drive Finder (via `osascript`/AppleScript) to style the already-mounted
 * volume named `productName`: icon view, no toolbar/statusbar, fixed window
 * bounds, the staged background picture, and the `.app` / `Applications`
 * icons positioned either side of the background's arrow.
 */
async function styleVolume(
  productName: string,
  window: { width: number; height: number },
  iconSize: number,
): Promise<void> {
  const x0 = 200
  const y0 = 150
  const x1 = x0 + window.width
  const y1 = y0 + window.height

  // The default background's arrow is centered at ~(320, 180) out of its
  // 640x420 canvas; these ratios keep the icons flanking it for custom
  // window sizes too.
  const iconY = Math.round((window.height * 175) / 420)
  const appX = Math.round(window.width / 2 - 155)
  const appsX = Math.round(window.width / 2 + 155)

  const volume = escapeAppleScript(productName)
  const appItem = escapeAppleScript(`${productName}.app`)

  // Set the background picture LAST, after the window is open and the icons are
  // placed, with delays between steps — Finder needs a beat to notice the
  // freshly-mounted volume's hidden `.background` folder, and setting the
  // picture too early throws `-10006 (can't set background picture)`.
  const script = `
tell application "Finder"
  tell disk "${volume}"
    open
    delay 1
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {${x0}, ${y0}, ${x1}, ${y1}}
    set theViewOptions to the icon view options of container window
    set arrangement of theViewOptions to not arranged
    set icon size of theViewOptions to ${iconSize}
    set position of item "${appItem}" of container window to {${appX}, ${iconY}}
    set position of item "Applications" of container window to {${appsX}, ${iconY}}
    delay 1
    set background picture of theViewOptions to file ".background:background.png"
    delay 1
    update without registering applications
    delay 1
    close
  end tell
end tell
`

  // Finder styling can be timing-sensitive; retry once with a short backoff to
  // ride out a transient hiccup. The common *persistent* failure is a missing
  // macOS Automation permission (see the caller's hint), which a retry won't
  // fix — so keep it to two attempts and fall back to a plain DMG quickly.
  let lastErr = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = spawnSync('osascript', ['-e', script], { encoding: 'utf8' })
    if (result.status === 0) return
    lastErr = (result.stderr || result.stdout).trim()
    if (attempt < 2) await delay(800)
  }
  throw new Error(`osascript styling failed: ${lastErr}`)
}

/** `hdiutil detach`, retrying once (forcefully) if the volume is busy. */
async function detachVolume(mountPoint: string): Promise<void> {
  let result = spawnSync('hdiutil', ['detach', mountPoint], { encoding: 'utf8' })
  if (result.status !== 0) {
    await delay(1000)
    result = spawnSync('hdiutil', ['detach', mountPoint, '-force'], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`hdiutil detach failed: ${result.stderr}`)
  }
}

/** Pull the `/Volumes/...` mount path out of `hdiutil attach`'s stdout. */
function parseMountPoint(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('/Volumes/')
    if (idx !== -1) return line.slice(idx).trim()
  }
  return null
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Apple notarization for `--notarize`, following Apple's documented flow:
 * https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
 * Submits the (Developer ID-signed) DMG to Apple's notary service, waits for
 * the result, then staples the ticket so Gatekeeper can verify it offline —
 * without stapling, a downloaded DMG needs network access to pass Gatekeeper.
 * Credentials are read from the environment only; murasaki never stores or
 * ships them.
 */
async function notarizeDmg(dmgPath: string): Promise<void> {
  const appleId = process.env.APPLE_ID
  const teamId = process.env.APPLE_TEAM_ID
  const password = process.env.APPLE_APP_PASSWORD
  const missing = [
    !appleId && 'APPLE_ID',
    !teamId && 'APPLE_TEAM_ID',
    !password && 'APPLE_APP_PASSWORD',
  ].filter((v): v is string => !!v)
  if (missing.length > 0) {
    throw new Error(
      `murasaki: --notarize requires ${missing.join(', ')} in the environment ` +
        '(an app-specific password for APPLE_APP_PASSWORD — see the README "Signing & distribution" section).',
    )
  }

  process.stdout.write(`\n${dim('submitting for notarization…')}\n`)
  const submit = spawnSync(
    'xcrun',
    [
      'notarytool',
      'submit',
      dmgPath,
      '--apple-id',
      appleId as string,
      '--team-id',
      teamId as string,
      '--password',
      password as string,
      '--wait',
    ],
    { stdio: 'inherit' },
  )
  if (submit.status !== 0) {
    throw new Error(
      'murasaki: notarization failed — run `xcrun notarytool log <submission-id>` (the id is ' +
        'printed above) for details.',
    )
  }

  const staple = spawnSync('xcrun', ['stapler', 'staple', dmgPath], { stdio: 'inherit' })
  if (staple.status !== 0) {
    throw new Error('murasaki: xcrun stapler staple failed.')
  }

  process.stdout.write(`\n${success('notarized and stapled')}\n\n`)
}

/** The original, unstyled DMG — used as a fallback if styling fails. */
async function plainDmg(staging: string, productName: string, dmgPath: string): Promise<void> {
  const result = spawnSync(
    'hdiutil',
    ['create', '-volname', productName, '-srcfolder', staging, '-ov', '-format', 'UDZO', dmgPath],
    { encoding: 'utf8' },
  )

  if (result.status !== 0) {
    process.stderr.write(`\n${error('hdiutil failed')}\n\n${result.stderr}\n`)
    process.exit(result.status ?? 1)
  }
}

// ── Windows: NSIS `.exe` + WiX `.msi` installers ───────────────────────────

/** The Evergreen WebView2 runtime's client registry GUID (Microsoft's own, not murasaki's) — see `nsiScript`'s `CheckWebView2`. */
const WEBVIEW2_CLIENT_GUID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
/** Microsoft's permalink to the WebView2 Evergreen Bootstrapper (the small stub installer that fetches the actual runtime). */
const WEBVIEW2_BOOTSTRAPPER_URL = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'

/**
 * win32 counterpart of the macOS `.dmg` path above: (re-)bundles via `bundle`
 * (mirrors the DMG path's re-bundle-by-default / `--no-build` convention),
 * then produces a NSIS `-setup.exe` and a WiX `.msi` from the staged
 * `dist/bundle/<productName>/` folder (bundle.ts's `bundleWin32`).
 *
 * Both `makensis` and `wix` are optional local tools — like the macOS path
 * degrading to a plain DMG when Automation permission is missing, this warns
 * and skips whichever tool isn't found rather than hard-failing, so
 * `murasaki installer --target win32-x64` still succeeds wherever only one
 * (or neither) is installed — e.g. this can run on a Mac with `makensis`
 * installed via `brew install makensis` to verify the NSIS script compiles,
 * even though `wix` (Windows-only) will always skip there. Both tools run in
 * CI (windows-latest), where both are installed.
 */
async function installerWin32(
  argv: string[],
  cwd: string,
  config: MurasakiConfig,
  arch: Arch,
): Promise<void> {
  const productName = config.productName
  const version = config.version ?? '0.0.0'
  const bundleDir = resolve(cwd, 'dist/bundle', productName)

  // Same re-bundle-by-default / --no-build convention as the darwin path.
  const skipBuild = argv.includes('--no-build')
  if (!skipBuild || !existsSync(bundleDir)) await bundle(argv)

  await mkdir(resolve(cwd, 'dist'), { recursive: true })

  const madeNsis = await buildNsisInstaller({ cwd, config, productName, version, bundleDir })
  const madeMsi = await buildMsiInstaller({ cwd, config, productName, version, bundleDir, arch })

  if (!madeNsis && !madeMsi) {
    process.stdout.write(
      `\n${warn('installer: neither makensis nor wix were found on PATH — no Windows installer produced.')}\n` +
        `${dim('  the portable folder/.zip from `murasaki bundle --target win32-x64` still works.')}\n` +
        `${dim('  install NSIS (https://nsis.sourceforge.net/, or `brew install makensis` on macOS) and/or WiX v4 (`dotnet tool install --global wix`).')}\n\n`,
    )
  }
}

/** Publisher shown in both installers' UI/registry — `config.installer.windows.publisher`, else `authors`, else `copyright`, else `productName`. */
function resolveWindowsPublisher(config: MurasakiConfig): string {
  return (
    config.installer?.windows?.publisher ??
    (config.authors && config.authors.length > 0 ? config.authors.join(', ') : undefined) ??
    config.copyright ??
    config.productName
  )
}

/**
 * Deterministic GUID derived from `seed` via SHA-256 — same input always
 * produces the same GUID, which is what makes MSI upgrades work (WiX's
 * `MajorUpgrade` matches on a stable `UpgradeCode`) without murasaki having
 * to persist generated GUIDs anywhere. Ported from the pre-v1 `src/wix.ts`.
 */
function deriveGuid(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`, // version nibble 4 ("name-based", loosely)
    `${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hash.slice(18, 20)}`, // variant bits 10xxxxxx
    hash.slice(20, 32),
  ]
    .join('-')
    .toUpperCase()
}

/** `"1.2.3"` → `"1.2.3.0"`, `"1.2"` → `"1.2.0.0"` — WiX/MSI versions are always 4 components. */
function padVersion(version: string): string {
  const parts = version
    .split(/[.-]/)
    .slice(0, 4)
    .map((p) => p.replace(/[^0-9]/g, '') || '0')
  while (parts.length < 4) parts.push('0')
  return parts.join('.')
}

/** `spawnSync(cmd, versionArgs)` succeeding (exit 0, no spawn error) — used to detect `makensis`/`wix` without hard-failing when they're missing. */
function detectTool(cmd: string, versionArgs: string[]): boolean {
  const result = spawnSync(cmd, versionArgs, { encoding: 'utf8' })
  return !result.error && result.status === 0
}

/**
 * Escapes a string for use inside a double-quoted NSIS literal: `$` starts a
 * variable/constant reference and `"` closes the string, so both need NSIS's
 * own escapes (`$$` and `$\"` respectively) rather than the backslash
 * escaping used to keep them literal in the generated JS below.
 */
function nsisEscape(s: string): string {
  return s.replace(/\$/g, '$$$$').replace(/"/g, '$\\"')
}

/**
 * Generates the `.nsi` script and runs `makensis` against it to produce
 * `dist/<productName>-<version>-setup.exe`. Returns `false` (without
 * throwing) if `makensis` isn't on PATH or compilation fails, so the caller
 * can fall through to the "no installer produced" notice.
 */
async function buildNsisInstaller(opts: {
  cwd: string
  config: MurasakiConfig
  productName: string
  version: string
  bundleDir: string
}): Promise<boolean> {
  const { cwd, config, productName, version, bundleDir } = opts

  if (!detectTool('makensis', ['-VERSION'])) {
    process.stdout.write(
      `\n${warn('installer: makensis not found — skipping the NSIS .exe installer.')}\n` +
        `${dim('  install NSIS: https://nsis.sourceforge.net/ (or `brew install makensis` on macOS, which can compile — but not run — the installer).')}\n\n`,
    )
    return false
  }

  const setupPath = resolve(cwd, 'dist', `${productName}-${version}-setup.exe`)
  await rm(setupPath, { force: true })

  const installMode = config.installer?.windows?.installMode ?? 'perUser'
  const publisher = resolveWindowsPublisher(config)

  const nsiDir = await mkdtemp(join(tmpdir(), 'murasaki-nsis-'))
  try {
    const nsiPath = join(nsiDir, 'installer.nsi')
    await writeFile(
      nsiPath,
      nsiScript({ productName, version, publisher, bundleDir, setupPath, installMode }),
    )

    const result = spawnSync('makensis', [nsiPath], { encoding: 'utf8' })
    if (result.status !== 0) {
      process.stdout.write(
        `\n${warn('installer: makensis failed, skipping the NSIS installer:')}\n${dim((result.stderr || result.stdout).trim())}\n\n`,
      )
      return false
    }

    process.stdout.write(`\n${success(`installer written  ${dim(setupPath)}`)}\n\n`)
    return true
  } finally {
    await rm(nsiDir, { recursive: true, force: true })
  }
}

/**
 * Builds the NSIS script text. Uses Modern UI 2 (`MUI2.nsh`, bundled with
 * every NSIS install) for the wizard pages, `NSISdl` (also bundled) to fetch
 * the WebView2 Evergreen Bootstrapper when the runtime isn't already present,
 * and installs per-user (`$LOCALAPPDATA\Programs\<productName>`, no admin) or
 * per-machine (`$PROGRAMFILES64\<productName>`, admin required) depending on
 * `installMode` — see `config.installer.windows.installMode`'s doc comment.
 *
 * `$INSTDIR`/`$SMPROGRAMS`/etc. below are genuine NSIS runtime variables
 * (single `$`, resolved on the *target* Windows machine at install time) —
 * distinct from the `${...}` JS template interpolations used throughout to
 * splice in already-known values (product name, paths, …) at *generation*
 * time. Every value that ends up inside an NSIS double-quoted string goes
 * through `nsisEscape` first so a stray `$`/`"` in config text (product name,
 * publisher, …) can't corrupt the script.
 */
function nsiScript(opts: {
  productName: string
  version: string
  publisher: string
  bundleDir: string
  setupPath: string
  installMode: 'perUser' | 'perMachine'
}): string {
  const { productName, version, publisher, bundleDir, setupPath, installMode } = opts
  const name = nsisEscape(productName)
  const pub = nsisEscape(publisher)
  const perMachine = installMode === 'perMachine'
  const execLevel = perMachine ? 'admin' : 'user'
  const shellCtx = perMachine ? 'all' : 'current'
  const regRoot = perMachine ? 'HKLM' : 'HKCU'
  // Runtime (target-machine) Windows paths — always backslash-separated
  // regardless of the build host, unlike the compile-time (host-filesystem)
  // paths below (setupPath / bundleDir), which use whatever separator
  // `node:path` gave them for the host actually running `makensis`.
  const installDir = perMachine ? `$PROGRAMFILES64\\${name}` : `$LOCALAPPDATA\\Programs\\${name}`
  const uninstallRegKey = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${name}`
  const exeRuntimePath = `$INSTDIR\\${name}.exe`
  // NSIS's `File /r "dir\*.*"` is the standard idiom for "everything under
  // dir, recursively" — despite the name, `*.*` matches extension-less files
  // too (a long-standing NSIS/DOS glob convention, not a literal dot filter).
  const sourceGlob = join(bundleDir, '*.*')

  return `Unicode true
!include "MUI2.nsh"

Name "${name}"
OutFile "${nsisEscape(setupPath)}"
InstallDir "${installDir}"
RequestExecutionLevel ${execLevel}
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "${exeRuntimePath}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${name}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetShellVarContext ${shellCtx}
  SetOutPath "$INSTDIR"
  File /r "${sourceGlob}"

  CreateDirectory "$SMPROGRAMS\\${name}"
  CreateShortcut "$SMPROGRAMS\\${name}\\${name}.lnk" "${exeRuntimePath}"
  CreateShortcut "$DESKTOP\\${name}.lnk" "${exeRuntimePath}"

  Call CheckWebView2

  WriteUninstaller "$INSTDIR\\Uninstall.exe"

  WriteRegStr ${regRoot} "${uninstallRegKey}" "DisplayName" "${name}"
  WriteRegStr ${regRoot} "${uninstallRegKey}" "DisplayVersion" "${nsisEscape(version)}"
  WriteRegStr ${regRoot} "${uninstallRegKey}" "Publisher" "${pub}"
  WriteRegStr ${regRoot} "${uninstallRegKey}" "InstallLocation" "$INSTDIR"
  WriteRegStr ${regRoot} "${uninstallRegKey}" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
  WriteRegStr ${regRoot} "${uninstallRegKey}" "QuietUninstallString" '"$INSTDIR\\Uninstall.exe" /S'
  WriteRegDWORD ${regRoot} "${uninstallRegKey}" "NoModify" 1
  WriteRegDWORD ${regRoot} "${uninstallRegKey}" "NoRepair" 1
SectionEnd

; Checks both the per-machine and per-user WebView2 Evergreen client
; registry keys; if neither reports an installed version ("pv"), downloads
; and silently runs Microsoft's Evergreen Bootstrapper so the app has a
; WebView2 runtime to render into on first launch.
Function CheckWebView2
  ReadRegStr $0 HKLM "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT_GUID}" "pv"
  StrCmp $0 "" webview2_check_user webview2_present
  webview2_check_user:
  ReadRegStr $0 HKCU "SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT_GUID}" "pv"
  StrCmp $0 "" webview2_download webview2_present
  webview2_download:
  DetailPrint "WebView2 Runtime not found - downloading the Evergreen Bootstrapper..."
  NSISdl::download "${WEBVIEW2_BOOTSTRAPPER_URL}" "$TEMP\\MicrosoftEdgeWebview2Setup.exe"
  Pop $0
  StrCmp $0 "success" webview2_install webview2_download_failed
  webview2_install:
  ExecWait '"$TEMP\\MicrosoftEdgeWebview2Setup.exe" /silent /install'
  Delete "$TEMP\\MicrosoftEdgeWebview2Setup.exe"
  Goto webview2_present
  webview2_download_failed:
  DetailPrint "WebView2 bootstrapper download failed - the app may not run until the runtime is installed manually."
  webview2_present:
FunctionEnd

Section "Uninstall"
  SetShellVarContext ${shellCtx}
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\\${name}\\${name}.lnk"
  RMDir "$SMPROGRAMS\\${name}"
  Delete "$DESKTOP\\${name}.lnk"
  DeleteRegKey ${regRoot} "${uninstallRegKey}"
SectionEnd
`
}

/**
 * Generates the `.wxs` (WiX v4) source and runs `wix build` to produce
 * `dist/<productName>-<version>.msi`. Returns `false` (without throwing) if
 * `wix` isn't on PATH (expected on macOS/Linux — WiX only runs on Windows;
 * verified in CI) or compilation fails.
 *
 * Adapts the pre-v1 `src/wix.ts`'s technique (deterministic GUIDs, WiX v4's
 * `<Files Include="dir\**" />` shorthand to harvest a folder without a
 * separate `heat.exe` pass) to the current `dist/bundle/<productName>/`
 * layout, plus a Start Menu shortcut component (not present in the archived
 * version). No WebView2 bootstrap here — the NSIS installer above carries
 * that; the MSI assumes the runtime is already present (documented in
 * config.ts). No UI wizard either (skips the `WixToolset.UI.wixext`
 * extension dependency) — the MSI is the silent/scripted-deploy option,
 * NSIS is the friendly one.
 */
async function buildMsiInstaller(opts: {
  cwd: string
  config: MurasakiConfig
  productName: string
  version: string
  bundleDir: string
  arch: Arch
}): Promise<boolean> {
  const { cwd, config, productName, version, bundleDir, arch } = opts

  if (!detectTool('wix', ['--version'])) {
    process.stdout.write(
      `\n${warn('installer: wix not found — skipping the .msi installer (expected on macOS/Linux; WiX is Windows-only).')}\n` +
        `${dim('  install: dotnet tool install --global wix')}\n\n`,
    )
    return false
  }

  const msiPath = resolve(cwd, 'dist', `${productName}-${version}.msi`)
  await rm(msiPath, { force: true })

  const publisher = resolveWindowsPublisher(config)
  const wixVersion = padVersion(version)
  const upgradeCode = config.installer?.windows?.upgradeCode ?? deriveGuid(`${config.appId}.upgrade`)
  const productCode = deriveGuid(`${config.appId}.${wixVersion}`)
  const wixArch = arch === 'arm64' ? 'arm64' : 'x64'

  const wxsDir = await mkdtemp(join(tmpdir(), 'murasaki-wix-'))
  try {
    const wxsPath = join(wxsDir, 'installer.wxs')
    await writeFile(
      wxsPath,
      wxsScript({ displayName: productName, version: wixVersion, publisher, upgradeCode, productCode, bundleDir }),
    )

    const result = spawnSync('wix', ['build', wxsPath, '-arch', wixArch, '-out', msiPath], {
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      process.stdout.write(
        `\n${warn('installer: wix build failed, skipping the .msi installer:')}\n${dim((result.stderr || result.stdout).trim())}\n\n`,
      )
      return false
    }

    process.stdout.write(`\n${success(`installer written  ${dim(msiPath)}`)}\n\n`)
    return true
  } finally {
    await rm(wxsDir, { recursive: true, force: true })
  }
}

function wxsScript(opts: {
  displayName: string
  version: string
  publisher: string
  upgradeCode: string
  productCode: string
  bundleDir: string
}): string {
  const { displayName, version, publisher, upgradeCode, productCode, bundleDir } = opts
  const name = escapeXmlAttr(displayName)
  const manufacturer = escapeXmlAttr(publisher)
  // WiX's `<Files Include>` glob wants `\` even in a source-relative sense
  // on non-Windows hosts too (it's WiX's own path syntax, not the shell's) —
  // matching the pre-v1 wix.ts, which used the same `\**` suffix
  // unconditionally.
  const sourceGlob = `${bundleDir}\\**`

  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package
    Name="${name}"
    Manufacturer="${manufacturer}"
    Version="${version}"
    UpgradeCode="${upgradeCode}"
    ProductCode="${productCode}"
    Scope="perMachine">

    <MajorUpgrade DowngradeErrorMessage="A newer version of [ProductName] is already installed." />
    <MediaTemplate EmbedCab="yes" CompressionLevel="high" />

    <Feature Id="Main" Title="${name}" Level="1">
      <ComponentGroupRef Id="HarvestedFiles" />
      <ComponentRef Id="StartMenuShortcut" />
    </Feature>

    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="${name}" />
    </StandardDirectory>

    <StandardDirectory Id="ProgramMenuFolder">
      <Directory Id="AppProgramMenuFolder" Name="${name}" />
    </StandardDirectory>

    <ComponentGroup Id="HarvestedFiles" Directory="INSTALLFOLDER">
      <Files Include="${escapeXmlAttr(sourceGlob)}" />
    </ComponentGroup>

    <Component Id="StartMenuShortcut" Directory="AppProgramMenuFolder" Guid="*">
      <Shortcut
        Id="AppStartMenuShortcut"
        Name="${name}"
        Target="[INSTALLFOLDER]${name}.exe"
        WorkingDirectory="INSTALLFOLDER" />
      <RemoveFolder Id="RemoveAppProgramMenuFolder" On="uninstall" />
      <RegistryValue Root="HKCU" Key="Software\\${manufacturer}\\${name}" Name="installed" Type="integer" Value="1" KeyPath="yes" />
    </Component>
  </Package>
</Wix>
`
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
