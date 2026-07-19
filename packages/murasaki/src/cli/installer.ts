import { resolve, join, dirname, basename } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, cp, copyFile, mkdir, symlink, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { success, warn, error, dim, unsignedNote } from './brand.js'
import bundle, { parseTarget, type Arch } from './bundle.js'
import type { MurasakiConfig } from '../config.js'
import { resolveAssociations, windowsProgId, type ResolvedAssociations } from '../associations.js'
import { loadUserConfig } from './load-config.js'
import { signWindowsArtifact } from './windows-signing.js'
import { writeArArchive, writeUstarTar, type TarEntry } from './deb.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DEFAULT_WINDOW = { width: 640, height: 420 }
const DEFAULT_ICON_SIZE = 128

/**
 * Produce a distributable installer for `--target <platform>-<arch>` (reuses
 * `bundle`'s `--target` parsing — see bundle.ts's `parseTarget`), defaulting
 * to the host platform/`config.targets[0]` the same way `bundle` does. Routes
 * to the darwin `.dmg` path (below), the win32 NSIS/MSI path
 * (`installerWin32`), or the Linux `.deb` path (`installerLinux`).
 */
export default async function installer(argv: string[]) {
  const cwd = process.cwd()
  const config = await loadUserConfig(cwd)
  const target = parseTarget(argv, config)

  if (target.platform === 'win32') {
    if (argv.includes('--notarize')) {
      throw new Error('murasaki: --notarize is only available for macOS DMG installers.')
    }
    await installerWin32(argv, cwd, config, target.arch)
    return
  }

  if (target.platform === 'linux') {
    if (argv.includes('--notarize')) {
      throw new Error('murasaki: --notarize is only available for macOS DMG installers.')
    }
    if (argv.includes('--sign')) {
      throw new Error(
        'murasaki: Linux .deb signing is not implemented. Refusing to emit an unsigned '
          + 'package for an explicit --sign request; build without --sign or sign it in a '
          + 'documented downstream Debian release pipeline.',
      )
    }
    await installerLinux(argv, cwd, config, target.arch)
    return
  }

  if (process.platform !== 'darwin') {
    process.stdout.write(
      `\n${warn('installer: a .dmg can only be built while running on macOS (win32/Linux targets can be built from any host with the right tools installed).')}\n\n`,
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
  // A reused bundle may only have the default ad-hoc signature. `--sign`
  // must always re-enter bundle so the exact app placed in this DMG receives
  // the requested Developer ID signature before the outer artifact is made.
  if (!skipBuild || !existsSync(appDir) || shouldSign) await bundle(argv)

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
 * `makensis` and `wix` are optional individually, but the installer command
 * fails when neither can produce an installer. A portable ZIP is a bundle,
 * not a successful installer result. Apps using built-in self-update produce
 * only NSIS: updating an MSI-owned installation out of band would violate
 * Windows Installer ownership/repair semantics. Managed MSI apps disable the
 * built-in updater and ship MSI major upgrades instead.
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
  const shouldSign = argv.includes('--sign')

  // Same re-bundle-by-default / --no-build convention as the darwin path.
  const skipBuild = argv.includes('--no-build')
  // `bundle --sign` signs the app-owned executable before creating the
  // portable ZIP. Force that pass even with --no-build so a stale unsigned
  // folder/ZIP can never be wrapped by a signed installer.
  if (!skipBuild || !existsSync(bundleDir) || shouldSign) await bundle(argv)

  await mkdir(resolve(cwd, 'dist'), { recursive: true })

  // Resolved once and handed to both builders below so a missing/misconfigured
  // asset only warns a single time (rather than once per installer type).
  const branding = resolveWindowsBranding(cwd, config, bundleDir)

  const nsisPath = await buildNsisInstaller({ cwd, config, productName, version, bundleDir, branding, arch })
  if (shouldSign && nsisPath) signWindowsArtifact(nsisPath, config, cwd)
  const msiPath = config.updater
    ? null
    : await buildMsiInstaller({ cwd, config, productName, version, bundleDir, arch, branding })
  if (config.updater) {
    process.stdout.write(
      `\n${dim('installer: MSI skipped because built-in self-update is enabled; the signed NSIS setup is the Windows update payload.')}\n\n`,
    )
  }
  if (shouldSign && msiPath) signWindowsArtifact(msiPath, config, cwd)

  if (!nsisPath && !msiPath) {
    throw new Error(
      config.updater
        ? 'murasaki: no Windows installer produced — built-in self-update requires NSIS; install makensis and retry'
        : 'murasaki: no Windows installer produced — install NSIS/makensis or WiX v4 and retry',
    )
  }
  if (!shouldSign) {
    const artifacts = [nsisPath, msiPath].filter((path): path is string => Boolean(path))
    process.stdout.write(
      `\n${warn('The generated Windows installer is unsigned. SmartScreen or application-control policy may block it.')}\n` +
        `${artifacts.map((path) => `${dim('  Artifact:')}  ${JSON.stringify(path)}`).join('\n')}\n` +
        `${dim('  For distribution, configure sign.windows and rerun with --sign. Do not ask users to disable Windows security controls.')}\n\n`,
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
 * Resolved `installer.windows` branding assets (absolute host-filesystem
 * paths), shared by both the NSIS and MSI builders — see each field's doc
 * comment in config.ts for the exact size/format each installer expects and
 * which NSIS/MSI setting it maps to. Any field is `null` when unset (or
 * configured but missing on disk, after a warning) — each generator omits
 * the corresponding customization, no fallback asset shipped for `banner`/
 * `sidebar`/`license` (NSIS side; the MSI's license page provides its own
 * placeholder — see `resolveMsiLicenseRtf`).
 */
interface WindowsBranding {
  icon: string | null
  banner: string | null
  sidebar: string | null
  license: string | null
}

/** Resolves `configuredPath` (relative to `cwd`) to an absolute path, warning and returning `null` if it's set but doesn't exist. `null` (no warning) if unset. */
function resolveBrandingAsset(
  cwd: string,
  configuredPath: string | undefined,
  label: string,
): string | null {
  if (!configuredPath) return null
  const abs = resolve(cwd, configuredPath)
  if (!existsSync(abs)) {
    process.stdout.write(`\n${warn(`installer: ${label} ${configuredPath} not found, skipping`)}\n`)
    return null
  }
  return abs
}

/** The installer icon: `installer.windows.icon` if set (and found), else the app icon's generated `<bundleDir>/resources/icon.ico` (from top-level `config.icon`), else `null` (both installers fall back to their own default icon). */
function resolveWindowsIcon(cwd: string, config: MurasakiConfig, bundleDir: string): string | null {
  const configured = resolveBrandingAsset(cwd, config.installer?.windows?.icon, 'installer icon')
  if (configured) return configured
  const defaultIcon = join(bundleDir, 'resources', 'icon.ico')
  return existsSync(defaultIcon) ? defaultIcon : null
}

function resolveWindowsBranding(
  cwd: string,
  config: MurasakiConfig,
  bundleDir: string,
): WindowsBranding {
  const windows = config.installer?.windows
  return {
    icon: resolveWindowsIcon(cwd, config, bundleDir),
    banner: resolveBrandingAsset(cwd, windows?.banner, 'installer banner'),
    sidebar: resolveBrandingAsset(cwd, windows?.sidebar, 'installer sidebar'),
    license: resolveBrandingAsset(cwd, windows?.license, 'installer license'),
  }
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
 * Resolves the `makensis` executable to a runnable command/path, or `null`
 * when NSIS isn't installed anywhere we can find it.
 *
 * Prefers a bare `makensis` on PATH — which covers `brew install makensis` on
 * macOS, the distro package on Linux, and Windows setups that opted NSIS onto
 * PATH. Falls back — on Windows only — to NSIS's default install locations,
 * because the NSIS Windows installer does **not** add itself to PATH (unlike
 * Homebrew/apt), so a stock `Program Files (x86)\NSIS\makensis.exe` is present
 * on disk yet invisible to a bare-name `spawnSync`, which fails with ENOENT
 * (confirmed on a clean Windows host — the reason a stock NSIS install looked
 * "not found"). The full path is passed as argv, not through a shell, so the
 * spaces in `Program Files (x86)` need no quoting.
 */
function resolveMakensis(): string | null {
  const override = process.env.MURASAKI_NSIS_PATH
  if (override !== undefined) {
    return override.length > 0 && detectTool(override, ['-VERSION']) ? override : null
  }
  if (detectTool('makensis', ['-VERSION'])) return 'makensis'
  if (process.platform === 'win32') {
    const roots = [
      process.env['ProgramFiles(x86)'],
      process.env.ProgramFiles,
      'C:\\Program Files (x86)',
      'C:\\Program Files',
    ].filter((r): r is string => Boolean(r))
    for (const root of roots) {
      const candidate = join(root, 'NSIS', 'makensis.exe')
      if (existsSync(candidate) && detectTool(candidate, ['-VERSION'])) return candidate
    }
  }
  return null
}

/** Resolves WiX, with an explicit override for reproducible toolchains/CI. */
function resolveWix(): string | null {
  const override = process.env.MURASAKI_WIX_PATH
  if (override !== undefined) {
    return override.length > 0 && detectTool(override, ['--version']) ? override : null
  }
  return detectTool('wix', ['--version']) ? 'wix' : null
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
 * BCP-47 locale → NSIS built-in language file name (NSIS ships these under
 * its own `Contents/Language files/`) plus the Windows "primary language
 * id" — the low 10 bits of a LANGID (`LANGID & 0x3FF`) — used by
 * `nsiScript`'s OS-language auto-detection in `.onInit`/`un.onInit` (mirrors
 * `detect_locale()` in the native menu bar's Rust launcher). One table is
 * the single source of truth for both the NSIS language declarations and
 * the detection comparison chain below, rather than two parallel tables.
 * Covers the locale set murasaki's native menu i18n ships translations for
 * (see menu-i18n.ts's `DEFAULT_LOCALES`). Locales outside this set fall back
 * to English, same as `resolveMenuLabels` falling back to its `FALLBACK`
 * locale. Primary ids per
 * https://learn.microsoft.com/windows/win32/intl/language-identifiers.
 */
const NSIS_LANGUAGES: Record<string, { name: string; primaryId: number }> = {
  en: { name: 'English', primaryId: 0x09 },
  ja: { name: 'Japanese', primaryId: 0x11 },
  'zh-Hans': { name: 'SimpChinese', primaryId: 0x04 },
  ko: { name: 'Korean', primaryId: 0x12 },
  es: { name: 'Spanish', primaryId: 0x0a },
  fr: { name: 'French', primaryId: 0x0c },
  de: { name: 'German', primaryId: 0x07 },
}

/**
 * Resolves `config.locales` to the ordered, deduplicated NSIS languages to
 * declare via `MUI_LANGUAGE` — the first entry becomes the installer's
 * default/fallback language (the same "first entry wins" convention
 * `resolveMenuLabels` uses for the native menu, and NSIS's own convention: a
 * `$LANGUAGE` left unset by `.onInit` falls back to whichever
 * `MUI_LANGUAGE` was inserted first). Defaults to `[English]` when
 * `locales` is unset or empty.
 */
function nsisLanguages(locales: string[] | undefined): { name: string; primaryId: number }[] {
  const list = locales && locales.length > 0 ? locales : ['en']
  const result: { name: string; primaryId: number }[] = []
  for (const locale of list) {
    const mapped = NSIS_LANGUAGES[locale] ?? NSIS_LANGUAGES.en
    if (!result.some((l) => l.name === mapped.name)) result.push(mapped)
  }
  return result
}

/**
 * The `${LANG_<NAME>}` NSIS preprocessor constant for a language name from
 * `nsisLanguages` (e.g. `"Japanese"` → `${LANG_JAPANESE}`). Built by plain
 * concatenation rather than a template literal so the literal `${...}`
 * reaches the generated `.nsi` text instead of being evaluated as a JS
 * interpolation.
 */
function nsisLangConstant(languageName: string): string {
  return '${LANG_' + languageName.toUpperCase() + '}'
}

/**
 * Generates NSIS instructions that read the OS UI language via the
 * always-bundled System plugin (`System.dll` ships with every NSIS
 * install — not an external plugin, same "built-in" status as `nsExec`/
 * `NSISdl` used elsewhere in this script) and set `$LANGUAGE` to the first
 * declared `languages` entry whose Windows primary language id matches —
 * mirroring `detect_locale()`'s OS-language-follows behavior in the native
 * menu bar, with no picker dialog. Matches on the *primary* id (masked with
 * `0x3FF`) rather than the full LANGID so regional variants (e.g. en-GB,
 * en-US) both resolve to the same declared language. When nothing matches,
 * `$LANGUAGE` is simply left untouched — it already holds NSIS's own
 * default (the first `!insertmacro MUI_LANGUAGE` declared, see
 * `nsisLanguages`) before `.onInit`/`un.onInit` runs, so that's the correct
 * fallback for free. `labelPrefix` keeps this block's labels distinct
 * between the installer's `.onInit` and the uninstaller's `un.onInit` (both
 * call this) — every label is explicit and unique, no relative `+N` jumps.
 */
function nsisLanguageDetection(
  languages: { name: string; primaryId: number }[],
  labelPrefix: string,
): string {
  const lines = [
    `System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'`,
    `IntOp $0 $0 & 0x3FF`,
  ]
  languages.forEach((lang, i) => {
    const matchLabel = `${labelPrefix}_match_${i}`
    const nextLabel = `${labelPrefix}_next_${i}`
    lines.push(`StrCmp $0 "${lang.primaryId}" ${matchLabel} ${nextLabel}`)
    lines.push(`${matchLabel}:`)
    lines.push(`StrCpy $LANGUAGE ${nsisLangConstant(lang.name)}`)
    lines.push(`Goto ${labelPrefix}_done`)
    lines.push(`${nextLabel}:`)
  })
  lines.push(`${labelPrefix}_done:`)
  return lines.map((l) => `  ${l}`).join('\n')
}

/**
 * The finish page's "Launch <app>" button text — the one app-specific custom
 * string in this script, so it's the one wrapped in a `LangString` (below).
 * Translated for Japanese; every other language falls back to the English
 * text, per this round's "keep it simple, don't over-translate" scope.
 */
function finishRunText(productName: string, languageName: string): string {
  return languageName === 'Japanese' ? `${productName} を起動` : `Launch ${productName}`
}

/**
 * The running-app guard's confirmation dialog text (see `nsiScript`'s
 * `un.onInit`, shown when the uninstaller detects `${name}.exe` still
 * running) — translated for every language `NSIS_LANGUAGES` maps to, so
 * the full shipped locale set gets a real translation instead of
 * `finishRunText`'s English-only fallback.
 *
 * Spells out both outcomes explicitly rather than phrasing it as a yes/no
 * question, because Cancel is now the dialog's default button (see
 * `uninstRunningGuard`) — the user needs to know what each button does
 * without relying on which one happens to be pre-selected.
 */
function uninstRunningText(productName: string, languageName: string): string {
  switch (languageName) {
    case 'Japanese':
      return `${productName} は実行中です。 [OK] 終了してアンインストールを続けます。 [キャンセル] 中止してインストールされたままにします。`
    case 'SimpChinese':
      return `${productName} 正在运行。 [确定] 关闭它并继续卸载。 [取消] 停止操作并保留安装。`
    case 'Korean':
      return `${productName}이(가) 실행 중입니다. [확인] 종료하고 제거를 계속합니다. [취소] 중단하고 설치된 상태로 둡니다.`
    case 'Spanish':
      return `${productName} se está ejecutando. [Aceptar] Ciérrelo y continúe con la desinstalación. [Cancelar] Deténgase y déjelo instalado.`
    case 'French':
      return `${productName} est en cours d'exécution. [OK] Fermez-le et poursuivez la désinstallation. [Annuler] Arrêtez et laissez-le installé.`
    case 'German':
      return `${productName} wird ausgeführt. [OK] Schließen und Deinstallation fortsetzen. [Abbrechen] Abbrechen und installiert lassen.`
    default:
      return `${productName} is running.  [OK] Close it and continue uninstalling.  [Cancel] Stop and leave it installed.`
  }
}

/**
 * Shown when the guard's `taskkill` didn't actually end the process (e.g. the
 * app is running at a higher integrity level than the non-elevated
 * uninstaller, so the kill silently fails with access denied) — the
 * uninstaller re-checks after killing and, if the process is still alive,
 * shows this instead of proceeding to delete files out from under it. Same
 * per-language coverage as `uninstRunningText`.
 */
function uninstKillFailedText(productName: string, languageName: string): string {
  switch (languageName) {
    case 'Japanese':
      return `${productName} を終了できませんでした。手動で終了してから、アンインストーラーを再度実行してください。`
    case 'SimpChinese':
      return `无法关闭 ${productName}。请手动关闭它,然后重新运行卸载程序。`
    case 'Korean':
      return `${productName}을(를) 종료할 수 없습니다. 수동으로 종료한 후 제거 프로그램을 다시 실행하세요.`
    case 'Spanish':
      return `No se pudo cerrar ${productName}. Ciérrelo manualmente y vuelva a ejecutar el desinstalador.`
    case 'French':
      return `Impossible de fermer ${productName}. Veuillez le fermer manuellement, puis relancer le désinstalleur.`
    case 'German':
      return `${productName} konnte nicht beendet werden. Bitte schließen Sie es manuell und führen Sie das Deinstallationsprogramm erneut aus.`
    default:
      return `Could not close ${productName}. Please close it manually, then run the uninstaller again.`
  }
}

/**
 * Generates the `.nsi` script and runs `makensis` against it to produce
 * `dist/<productName>-<version>-setup-<arch>.exe` (arch-suffixed so a win32
 * arm64 build's installer can't collide with — or silently overwrite — an
 * x64 build's, and so `murasaki release --manifest` can tell the two apart;
 * see release.ts's manifest scan, which also still recognizes the legacy
 * un-suffixed `-setup.exe` name for already-published win32-x64 assets).
 * Returns `null` (without throwing) if `makensis` isn't on PATH or
 * compilation fails, so the caller can fall through to the "no installer
 * produced" notice.
 */
async function buildNsisInstaller(opts: {
  cwd: string
  config: MurasakiConfig
  productName: string
  version: string
  bundleDir: string
  branding: WindowsBranding
  arch: Arch
}): Promise<string | null> {
  const { cwd, config, productName, version, bundleDir, branding, arch } = opts

  const makensis = resolveMakensis()
  if (!makensis) {
    process.stdout.write(
      `\n${warn('installer: makensis not found — skipping the NSIS .exe installer.')}\n` +
        `${dim('  install NSIS: https://nsis.sourceforge.net/ (or `brew install makensis` on macOS, which can compile — but not run — the installer).')}\n\n`,
    )
    return null
  }

  const setupPath = resolve(cwd, 'dist', `${productName}-${version}-setup-${arch}.exe`)
  await rm(setupPath, { force: true })

  const installMode = config.installer?.windows?.installMode ?? 'perUser'
  const publisher = resolveWindowsPublisher(config)

  const nsiDir = await mkdtemp(join(tmpdir(), 'murasaki-nsis-'))
  try {
    const nsiPath = join(nsiDir, 'installer.nsi')
    // Prepend a UTF-8 BOM so makensis reads the script as UTF-8 regardless of
    // the host's ANSI codepage. Without it, a non-ASCII byte — the © in a
    // copyright string, a Japanese LangString like "起動" — is decoded in the
    // system codepage (CP932 on a Japanese Windows host) and makensis aborts
    // with "Bad text encoding". `Unicode true` inside the script controls the
    // *output* installer's encoding, not how the *source* file is read.
    const nsi = await nsiScript({
      appId: config.appId,
      productName,
      description: config.description,
      version,
      publisher,
      bundleDir,
      setupPath,
      installMode,
      locales: config.locales,
      branding,
      associations: resolveAssociations(config),
    })
    await writeFile(nsiPath, `\uFEFF${nsi}`)

    const result = spawnSync(makensis, [nsiPath], { encoding: 'utf8' })
    if (result.status !== 0) {
      process.stdout.write(
        `\n${warn('installer: makensis failed, skipping the NSIS installer:')}\n${dim((result.stderr || result.stdout).trim())}\n\n`,
      )
      return null
    }

    process.stdout.write(`\n${success(`installer written  ${dim(setupPath)}`)}\n\n`)
    return setupPath
  } finally {
    await rm(nsiDir, { recursive: true, force: true })
  }
}

/**
 * Recursively walks `bundleDir` and reports the single largest file, for
 * `nsiScript`'s progress-bar fix (see `installFilesInstructions`) — NSIS's
 * InstFiles progress bar advances one tick per executed instruction
 * regardless of the bytes that instruction actually copies, so extracting
 * the dominant file (often ~90%+ of total bundle size, e.g. the bundled
 * `node.exe`) as its own LAST `File` instruction is what keeps the bar
 * tracking real progress instead of freezing then jumping to 100%.
 *
 * Returns `null` when splitting it out isn't worth it: either it isn't a
 * meaningful share of the payload (< 30% of the bundle's total bytes), or its
 * basename collides with another file elsewhere in the tree — an `/x
 * <basename>` exclusion in `installFilesInstructions` would then also
 * (wrongly) exclude that other file.
 */
async function findDominantFile(
  bundleDir: string,
): Promise<{ absPath: string; relPath: string; basename: string } | null> {
  const files: { absPath: string; relPath: string; basename: string; size: number }[] = []

  async function walk(dir: string, relDir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(abs, rel)
      } else if (entry.isFile()) {
        const { size } = await stat(abs)
        files.push({ absPath: abs, relPath: rel, basename: entry.name, size })
      }
    }
  }
  await walk(bundleDir, '')
  if (files.length === 0) return null

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  const largest = files.reduce((max, f) => (f.size > max.size ? f : max))
  if (totalBytes === 0 || largest.size < totalBytes * 0.3) return null
  if (files.filter((f) => f.basename === largest.basename).length > 1) return null

  return { absPath: largest.absPath, relPath: largest.relPath, basename: largest.basename }
}

/**
 * Builds the install section's `File` instruction(s) for `sourceGlob`. With
 * no `dominant` file (see `findDominantFile`), this is just the original
 * single `File /r` extraction. With one, the dominant file is excluded from
 * the `/r` extraction (`/x <basename>`) and instead extracted by itself as
 * the LAST instruction — see `findDominantFile`'s doc comment for WHY this
 * ordering matters (NSIS's InstFiles progress bar is instruction-count
 * based, not byte based).
 */
function installFilesInstructions(
  sourceGlob: string,
  dominant: { absPath: string; relPath: string; basename: string } | null,
): string {
  if (!dominant) return `File /r "${sourceGlob}"`
  return `File /r /x "${nsisEscape(dominant.basename)}" "${sourceGlob}"`
}

/**
 * Extracts the dominant file, emitted as the very LAST instructions of the
 * install section (after the shortcuts, the uninstaller and the registry
 * writes — none of which depend on this file existing yet). The progress bar
 * ticks once per instruction, so anything emitted after this would keep the
 * bar short of full for the entire multi-second extraction; putting it dead
 * last means the bar climbs through everything else first and only then sits
 * on the big file, which is what "almost done" is supposed to look like.
 * Empty when there's no dominant file — `installFilesInstructions` then
 * already extracted everything.
 */
function dominantFileInstructions(
  dominant: { absPath: string; relPath: string; basename: string } | null,
): string {
  if (!dominant) return ''

  const slash = dominant.relPath.lastIndexOf('/')
  const relDir = slash === -1 ? '' : dominant.relPath.slice(0, slash)
  const bigFile = `File "${nsisEscape(dominant.absPath)}"`
  if (relDir === '') return bigFile

  const relDirWin = nsisEscape(relDir.split('/').join('\\'))
  return `SetOutPath "$INSTDIR\\${relDirWin}"\n  ${bigFile}\n  SetOutPath "$INSTDIR"`
}

/**
 * Builds the NSIS script text. Uses Modern UI 2 (`MUI2.nsh`, bundled with
 * every NSIS install) for the wizard pages, `NSISdl` (also bundled) to fetch
 * the WebView2 Evergreen Bootstrapper when the runtime isn't already present,
 * and installs per-user (`$LOCALAPPDATA\Programs\<productName>`, no admin) or
 * per-machine (`$PROGRAMFILES64\<productName>`, admin required) depending on
 * `installMode` — see `config.installer.windows.installMode`'s doc comment.
 *
 * `locales` (top-level `config.locales`) drives which `MUI_LANGUAGE`s get
 * declared (see `nsisLanguages`). There's no language-picker dialog — both
 * `.onInit` and `un.onInit` auto-detect the OS UI language and select the
 * matching declared language (`nsisLanguageDetection`), the same
 * OS-language-follows behavior `detect_locale()` gives the native menu bar.
 * An unmatched OS language falls back to the first declared language, same
 * as NSIS's own default.
 * `branding` (`config.installer.windows.{icon,banner,sidebar,license}`) maps
 * onto `MUI_ICON`/`MUI_UNICON`, `MUI_HEADERIMAGE_BITMAP`,
 * `MUI_WELCOMEFINISHPAGE_BITMAP`, and an optional `MUI_PAGE_LICENSE` (added
 * only when `branding.license` is set).
 *
 * `$INSTDIR`/`$SMPROGRAMS`/etc. below are genuine NSIS runtime variables
 * (single `$`, resolved on the *target* Windows machine at install time) —
 * distinct from the `${...}` JS template interpolations used throughout to
 * splice in already-known values (product name, paths, …) at *generation*
 * time. Every value that ends up inside an NSIS double-quoted string goes
 * through `nsisEscape` first so a stray `$`/`"` in config text (product name,
 * publisher, …) can't corrupt the script.
 */
export function nsisAssociationRegistry(opts: {
  appId: string
  productName: string
  description?: string
  executableName: string
  regRoot: 'HKCU' | 'HKLM'
  associations: ResolvedAssociations
}): { install: string; uninstall: string } {
  const { appId, productName, description, executableName, regRoot, associations } = opts
  if (associations.protocols.length === 0 && associations.files.length === 0) {
    return { install: '', uninstall: '' }
  }
  const appKey = windowsProgId(appId, 'Application')
  const capabilitiesKey = `Software\\${appKey}\\Capabilities`
  const registeredName = `${productName} (${appId})`
  const applicationDescription = description?.trim() || `${productName} desktop application`
  const install: string[] = [
    `  WriteRegStr ${regRoot} "${nsisEscape(capabilitiesKey)}" "ApplicationDescription" "${nsisEscape(applicationDescription)}"`,
    `  WriteRegStr ${regRoot} "${nsisEscape(capabilitiesKey)}" "ApplicationName" "${nsisEscape(registeredName)}"`,
    `  WriteRegStr ${regRoot} "${nsisEscape(capabilitiesKey)}" "MurasakiInstallPath" "$INSTDIR"`,
  ]
  const uninstall: string[] = []

  associations.protocols.forEach((protocol, index) => {
    const scheme = nsisEscape(protocol.scheme)
    const schemeKey = `Software\\Classes\\${scheme}`
    const progId = windowsProgId(appId, `Url.${protocol.scheme}`)
    const progIdKey = `Software\\Classes\\${progId}`
    const command = `'"$INSTDIR\\${executableName}.exe" "%1"'`
    const schemeWrite = `murasaki_protocol_${index}_scheme_write`
    const schemeDone = `murasaki_protocol_${index}_scheme_done`
    install.push(
      `  ReadRegStr $0 ${regRoot} "${schemeKey}\\shell\\open\\command" ""`,
      `  StrCmp $0 "" ${schemeWrite}`,
      `  ReadRegStr $1 ${regRoot} "${schemeKey}" "MurasakiAppId"`,
      `  StrCmp $1 "${nsisEscape(appId)}" ${schemeWrite}`,
      `  StrCmp $0 ${command} ${schemeWrite} ${schemeDone}`,
      `  ${schemeWrite}:`,
      `  WriteRegStr ${regRoot} "${schemeKey}" "" "URL:${nsisEscape(protocol.name)}"`,
      `  WriteRegStr ${regRoot} "${schemeKey}" "URL Protocol" ""`,
      `  WriteRegStr ${regRoot} "${schemeKey}" "MurasakiAppId" "${nsisEscape(appId)}"`,
      `  WriteRegStr ${regRoot} "${schemeKey}\\DefaultIcon" "" "$INSTDIR\\${executableName}.exe,0"`,
      `  WriteRegStr ${regRoot} "${schemeKey}\\shell\\open\\command" "" ${command}`,
      `  ${schemeDone}:`,
      `  WriteRegStr ${regRoot} "${nsisEscape(progIdKey)}" "" "URL:${nsisEscape(protocol.name)}"`,
      `  WriteRegStr ${regRoot} "${nsisEscape(progIdKey)}" "URL Protocol" ""`,
      `  WriteRegStr ${regRoot} "${nsisEscape(progIdKey)}\\DefaultIcon" "" "$INSTDIR\\${executableName}.exe,0"`,
      `  WriteRegStr ${regRoot} "${nsisEscape(progIdKey)}\\shell\\open\\command" "" ${command}`,
      `  WriteRegStr ${regRoot} "${nsisEscape(capabilitiesKey)}\\URLAssociations" "${scheme}" "${nsisEscape(progId)}"`,
    )
    const schemeNotOwned = `murasaki_protocol_${index}_scheme_not_owned`
    const progIdNotOwned = `murasaki_protocol_${index}_progid_not_owned`
    uninstall.push(
      `  ReadRegStr $0 ${regRoot} "${schemeKey}\\shell\\open\\command" ""`,
      `  StrCmp $0 ${command} 0 ${schemeNotOwned}`,
      `  DeleteRegKey ${regRoot} "${schemeKey}"`,
      `  ${schemeNotOwned}:`,
      `  ReadRegStr $0 ${regRoot} "${nsisEscape(progIdKey)}\\shell\\open\\command" ""`,
      `  StrCmp $0 ${command} 0 ${progIdNotOwned}`,
      `  DeleteRegKey ${regRoot} "${nsisEscape(progIdKey)}"`,
      `  ${progIdNotOwned}:`,
    )
  })

  associations.files.forEach((file, fileIndex) => {
    file.extensions.forEach((extension, extensionIndex) => {
      const progId = windowsProgId(appId, extension)
      const dotExtension = `.${extension}`
      const openWithKey = `Software\\Classes\\${dotExtension}\\OpenWithProgids`
      const progIdKey = `Software\\Classes\\${progId}`
      const command = `'"$INSTDIR\\${executableName}.exe" "%1"'`
      install.push(
        `  WriteRegStr ${regRoot} "${nsisEscape(openWithKey)}" "${nsisEscape(progId)}" ""`,
        `  WriteRegStr ${regRoot} "${nsisEscape(progIdKey)}" "" "${nsisEscape(file.description)}"`,
        `  WriteRegStr ${regRoot} "${nsisEscape(progIdKey)}\\DefaultIcon" "" "$INSTDIR\\${executableName}.exe,0"`,
        `  WriteRegStr ${regRoot} "${nsisEscape(progIdKey)}\\shell\\open\\command" "" ${command}`,
        `  WriteRegStr ${regRoot} "${nsisEscape(capabilitiesKey)}\\FileAssociations" "${dotExtension}" "${nsisEscape(progId)}"`,
        ...(file.mimeType && extensionIndex === 0
          ? [`  WriteRegStr ${regRoot} "${nsisEscape(capabilitiesKey)}\\MIMEAssociations" "${nsisEscape(file.mimeType)}" "${nsisEscape(progId)}"`]
          : []),
      )
      const skip = `murasaki_file_${fileIndex}_${extensionIndex}_not_owned`
      uninstall.push(
        `  ReadRegStr $0 ${regRoot} "${nsisEscape(progIdKey)}\\shell\\open\\command" ""`,
        `  StrCmp $0 ${command} 0 ${skip}`,
        `  DeleteRegValue ${regRoot} "${nsisEscape(openWithKey)}" "${nsisEscape(progId)}"`,
        `  DeleteRegKey ${regRoot} "${nsisEscape(progIdKey)}"`,
        `  ${skip}:`,
      )
    })
  })

  install.push(
    `  WriteRegStr ${regRoot} "Software\\RegisteredApplications" "${nsisEscape(registeredName)}" "${nsisEscape(capabilitiesKey)}"`,
    `  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'`,
  )
  const capabilitiesNotOwned = 'murasaki_capabilities_not_owned'
  uninstall.push(
    `  ReadRegStr $0 ${regRoot} "${nsisEscape(capabilitiesKey)}" "MurasakiInstallPath"`,
    `  StrCmp $0 "$INSTDIR" 0 ${capabilitiesNotOwned}`,
    `  DeleteRegValue ${regRoot} "Software\\RegisteredApplications" "${nsisEscape(registeredName)}"`,
    `  DeleteRegKey ${regRoot} "${nsisEscape(capabilitiesKey)}"`,
    `  ${capabilitiesNotOwned}:`,
  )
  return { install: install.join('\n'), uninstall: uninstall.join('\n') }
}

export async function nsiScript(opts: {
  appId: string
  productName: string
  description?: string
  version: string
  publisher: string
  bundleDir: string
  setupPath: string
  installMode: 'perUser' | 'perMachine'
  locales?: string[]
  branding: WindowsBranding
  associations: ResolvedAssociations
}): Promise<string> {
  const { appId, productName, description, version, publisher, bundleDir, setupPath, installMode, locales, branding, associations } = opts
  const name = nsisEscape(productName)
  const pub = nsisEscape(publisher)
  const perMachine = installMode === 'perMachine'
  const execLevel = perMachine ? 'admin' : 'user'
  const shellCtx = perMachine ? 'all' : 'current'
  const regRoot = perMachine ? 'HKLM' : 'HKCU'
  // Runtime (target-machine) Windows paths — always backslash-separated
  // regardless of the build host, unlike the compile-time (host-filesystem)
  // paths below (setupPath / bundleDir / branding assets), which use
  // whatever separator `node:path` gave them for the host actually running
  // `makensis`.
  const installDir = perMachine ? `$PROGRAMFILES64\\${name}` : `$LOCALAPPDATA\\Programs\\${name}`
  const uninstallRegKey = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${name}`
  // Stable across product-name/config changes so an upgrade can run the old
  // embedded uninstaller before writing the new association set. Without
  // this, protocols or extensions removed from config survive indefinitely.
  const installStateKey = `Software\\${nsisEscape(windowsProgId(appId, 'Application'))}\\Install`
  const exeRuntimePath = `$INSTDIR\\${name}.exe`
  // NSIS's `File /r "dir\*.*"` is the standard idiom for "everything under
  // dir, recursively" — despite the name, `*.*` matches extension-less files
  // too (a long-standing NSIS/DOS glob convention, not a literal dot filter).
  const sourceGlob = join(bundleDir, '*.*')
  // The single largest file in the bundle (if it's worth splitting out — see
  // findDominantFile), extracted LAST by installFilesInstructions below
  // instead of being lumped into the `/r` extraction.
  const dominant = await findDominantFile(bundleDir)
  const associationRegistry = nsisAssociationRegistry({ appId, productName, description, regRoot, executableName: name, associations })

  const languages = nsisLanguages(locales)
  const languageNames = languages.map((l) => l.name)

  const brandingDefines = [
    branding.icon ? `!define MUI_ICON "${nsisEscape(branding.icon)}"` : '',
    branding.icon ? `!define MUI_UNICON "${nsisEscape(branding.icon)}"` : '',
    branding.banner ? '!define MUI_HEADERIMAGE' : '',
    branding.banner ? `!define MUI_HEADERIMAGE_BITMAP "${nsisEscape(branding.banner)}"` : '',
    branding.sidebar ? `!define MUI_WELCOMEFINISHPAGE_BITMAP "${nsisEscape(branding.sidebar)}"` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const pages = [
    '!insertmacro MUI_PAGE_WELCOME',
    branding.license ? `!insertmacro MUI_PAGE_LICENSE "${nsisEscape(branding.license)}"` : '',
    '!insertmacro MUI_PAGE_DIRECTORY',
    '!insertmacro MUI_PAGE_INSTFILES',
    `!define MUI_FINISHPAGE_RUN "${exeRuntimePath}"`,
    // Resolved at runtime via the LangString reference ($(...)) rather than
    // inlined directly, so it's translated per the selected installer
    // language — see the LangString declarations below.
    '!define MUI_FINISHPAGE_RUN_TEXT "$(FINISHPAGE_RUN_TEXT)"',
    '!insertmacro MUI_PAGE_FINISH',
  ]
    .filter(Boolean)
    .join('\n')

  const languageMacros = languageNames.map((n) => `!insertmacro MUI_LANGUAGE "${n}"`).join('\n')

  // One LangString per declared language — English + a Japanese translation
  // at minimum; every other declared language falls back to the English
  // text (see `finishRunText`). Standard wizard strings (Next/Back/Install/
  // …) come from NSIS's own bundled per-language files and need no
  // translation here.
  const langStrings = languageNames
    .map(
      (n) =>
        `LangString FINISHPAGE_RUN_TEXT ${nsisLangConstant(n)} "${nsisEscape(finishRunText(productName, n))}"`,
    )
    .join('\n')

  // Companion `LangString`s for the running-app guard's MessageBoxes in
  // `un.onInit` (below) — same one-per-declared-language wiring as
  // `langStrings`, just different source strings: the confirm dialog shown
  // before the kill, and the error dialog shown if the kill didn't take.
  const uninstRunningLangStrings = languageNames
    .map(
      (n) =>
        `LangString UNINST_RUNNING_TEXT ${nsisLangConstant(n)} "${nsisEscape(uninstRunningText(productName, n))}"`,
    )
    .join('\n')

  const uninstKillFailedLangStrings = languageNames
    .map(
      (n) =>
        `LangString UNINST_KILL_FAILED_TEXT ${nsisLangConstant(n)} "${nsisEscape(uninstKillFailedText(productName, n))}"`,
    )
    .join('\n')

  // Always emitted (no language-picker guard needed anymore) — detects the
  // OS UI language and selects the matching declared language, no dialog.
  // See `nsisLanguageDetection`'s doc comment.
  const onInit = `Function .onInit
${nsisLanguageDetection(languages, 'instlang')}
FunctionEnd`

  // Run only after the user crosses the Install confirmation page. Doing
  // this in .onInit would remove the working version merely by opening the
  // setup and then cancelling on Welcome/license/directory selection.
  const removePreviousInstall = `ReadRegStr $0 ${regRoot} "${installStateKey}" "Uninstaller"
  StrCmp $0 "" murasaki_upgrade_done
  IfFileExists "$0" 0 murasaki_upgrade_stale
  DetailPrint "Removing the previous version..."
  ExecWait '"$0" /S' $1
  StrCmp $1 "0" murasaki_upgrade_done
  DetailPrint "Previous-version removal failed with exit code $1."
  Abort
  murasaki_upgrade_stale:
  DeleteRegKey ${regRoot} "${installStateKey}"
  murasaki_upgrade_done:`

  // Detects whether `${name}.exe` is still running via the always-bundled
  // `nsExec` plugin plus Windows' built-in `tasklist`/`taskkill` (no external
  // NSIS plugin) — `find` exits 0 when the image name shows up in the
  // filtered `tasklist` output, i.e. the app is running. Reused verbatim for
  // both the initial check and the post-kill re-check below.
  const detectRunningCmd = `nsExec::ExecToStack '"$SYSDIR\\cmd.exe" /c tasklist /FI "IMAGENAME eq ${name}.exe" /NH | find /I "${name}.exe"'
  Pop $0
  Pop $1`

  // Interactive uninstalls confirm via MessageBox before killing — Cancel is
  // the *default* button (`MB_DEFBUTTON2`) since it's the safer outcome, and
  // Cancel aborts the uninstall. Silent uninstalls (`/S`, used by
  // `QuietUninstallString`) skip the dialog and kill without prompting.
  //
  // Killing the launcher alone is normally enough — its Job Object takes its
  // `node` child down with it — but real-hardware testing found `taskkill`
  // can silently fail (most likely: the app is running elevated relative to
  // this non-elevated uninstaller, i.e. "Access is denied") while the
  // uninstall proceeded anyway, deleting files out from under a still-live
  // app. So after the `Sleep` (giving Windows a moment to release file locks)
  // the *same* detection command runs again — the uninstall only proceeds if
  // that re-check confirms the process is actually gone; otherwise it shows
  // an error and aborts rather than ever assuming the kill worked.
  const uninstRunningGuard = `  ${detectRunningCmd}
  StrCmp $0 "0" 0 murasaki_uninst_notrunning
  IfSilent murasaki_uninst_kill
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "$(UNINST_RUNNING_TEXT)" IDOK murasaki_uninst_kill
  Abort
  murasaki_uninst_kill:
  nsExec::ExecToStack '"$SYSDIR\\taskkill.exe" /F /IM "${name}.exe"'
  Pop $0
  Pop $1
  Sleep 1500
  ${detectRunningCmd}
  StrCmp $0 "0" murasaki_uninst_killfailed murasaki_uninst_notrunning
  murasaki_uninst_killfailed:
  MessageBox MB_OK|MB_ICONSTOP "$(UNINST_KILL_FAILED_TEXT)" /SD IDOK
  Abort
  murasaki_uninst_notrunning:`

  // Language detection runs BEFORE the running-app guard so the guard's own
  // MessageBox (above) is shown in the detected language rather than
  // whatever `$LANGUAGE` happened to default to.
  const unOnInit = `Function un.onInit
${nsisLanguageDetection(languages, 'unlang')}
${uninstRunningGuard}
FunctionEnd`

  // `ManifestSupportedOS all` embeds a modern-OS compatibility manifest. Without
  // it, NSIS ships only its Vista-era manifest, and our installer finishes fast
  // enough that Windows' Program Compatibility Assistant flags it after the fact
  // with "this program might not have installed correctly" — even on a perfectly
  // good install. Declaring OS support opts the installer out of that PCA
  // heuristic. See https://nsis.sourceforge.io/Reference/ManifestSupportedOS.
  const header = `Unicode true
!include "MUI2.nsh"

Name "${name}"
OutFile "${nsisEscape(setupPath)}"
InstallDir "${installDir}"
RequestExecutionLevel ${execLevel}
ManifestSupportedOS all
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING`

  const installSection = `Section "Install"
  SetShellVarContext ${shellCtx}
  ${removePreviousInstall}
  SetOutPath "$INSTDIR"
  ; Everything except the dominant file (see findDominantFile) — that one is
  ; extracted at the very bottom of this section. NSIS's InstFiles progress
  ; bar advances one tick per File instruction, not per byte, so extracting a
  ; huge file (e.g. the bundled node.exe) any earlier would park the bar
  ; short of full for nearly the whole install instead of tracking progress.
  ${installFilesInstructions(sourceGlob, dominant)}

  CreateDirectory "$SMPROGRAMS\\${name}"
  CreateShortcut "$SMPROGRAMS\\${name}\\${name}.lnk" "${exeRuntimePath}"
  CreateShortcut "$DESKTOP\\${name}.lnk" "${exeRuntimePath}"

  Call CheckWebView2

  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  WriteRegStr ${regRoot} "${installStateKey}" "InstallPath" "$INSTDIR"
  WriteRegStr ${regRoot} "${installStateKey}" "Uninstaller" "$INSTDIR\\Uninstall.exe"

${associationRegistry.install}

  WriteRegStr ${regRoot} "${uninstallRegKey}" "DisplayName" "${name}"
  WriteRegStr ${regRoot} "${uninstallRegKey}" "DisplayVersion" "${nsisEscape(version)}"
  WriteRegStr ${regRoot} "${uninstallRegKey}" "Publisher" "${pub}"
  WriteRegStr ${regRoot} "${uninstallRegKey}" "InstallLocation" "$INSTDIR"
  WriteRegStr ${regRoot} "${uninstallRegKey}" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
  WriteRegStr ${regRoot} "${uninstallRegKey}" "QuietUninstallString" '"$INSTDIR\\Uninstall.exe" /S'
  WriteRegDWORD ${regRoot} "${uninstallRegKey}" "NoModify" 1
  WriteRegDWORD ${regRoot} "${uninstallRegKey}" "NoRepair" 1

  ; Dead last on purpose — see dominantFileInstructions.
  ${dominantFileInstructions(dominant)}
SectionEnd`

  const webview2Fn = `; Checks both the per-machine and per-user WebView2 Evergreen client
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
FunctionEnd`

  const uninstallSection = `Section "Uninstall"
  SetShellVarContext ${shellCtx}
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\\${name}\\${name}.lnk"
  RMDir "$SMPROGRAMS\\${name}"
  Delete "$DESKTOP\\${name}.lnk"
${associationRegistry.uninstall}
  ReadRegStr $0 ${regRoot} "${installStateKey}" "InstallPath"
  StrCmp $0 "$INSTDIR" 0 murasaki_install_state_not_owned
  DeleteRegKey ${regRoot} "${installStateKey}"
  murasaki_install_state_not_owned:
  DeleteRegKey ${regRoot} "${uninstallRegKey}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd`

  return (
    [
      header,
      brandingDefines,
      pages,
      '!insertmacro MUI_UNPAGE_CONFIRM\n!insertmacro MUI_UNPAGE_INSTFILES',
      languageMacros,
      langStrings,
      uninstRunningLangStrings,
      uninstKillFailedLangStrings,
      installSection,
      onInit,
      webview2Fn,
      uninstallSection,
      unOnInit,
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  )
}

/**
 * Resolves the MSI wizard's `WixUILicenseRtf` path: `branding.license` if set
 * (already existence-checked, see `resolveWindowsBranding`), else a minimal
 * placeholder `.rtf` written into `wxsDir` — unlike the NSIS side (where the
 * license page itself is skipped when unconfigured), `WixUI_InstallDir`'s
 * license page is always part of the wizard sequence, so it always needs
 * *some* RTF to display.
 */
async function resolveMsiLicenseRtf(branding: WindowsBranding, wxsDir: string): Promise<string> {
  if (branding.license) return branding.license
  const placeholderPath = join(wxsDir, 'license-placeholder.rtf')
  await writeFile(
    placeholderPath,
    String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fswiss Helvetica;}}\f0\pard\fs18 No license was provided for this application.\par}`,
  )
  return placeholderPath
}

/**
 * Generates the `.wxs` (WiX v4) source and runs `wix build` to produce
 * `dist/<productName>-<version>.msi`. Returns `null` (without throwing) if
 * `wix` isn't on PATH (expected on macOS/Linux — WiX only runs on Windows;
 * verified in CI) or compilation fails.
 *
 * Ports the pre-v1 `src/wix.ts`'s deterministic-GUID technique to the
 * current `dist/bundle/<productName>/` layout, plus a Start Menu shortcut
 * component (not present in the archived version). Unlike that archived
 * version, files are enumerated explicitly (one `<Component>`/`<File>` per
 * file, mirroring `bundleDir`'s tree as nested `<Directory>` elements) rather
 * than via WiX's `<Files Include="dir\**" />` auto-harvest shorthand — that
 * shorthand is rejected (`WIX0005`) under `ComponentGroup`/`Feature`/
 * `Directory` in WiX v4.0.6 (confirmed against the real toolset, both
 * locally via `dotnet wix.dll build` and in CI), so it can't be used here.
 * No WebView2 bootstrap here — the NSIS installer above carries that; the
 * MSI assumes the runtime is already present (documented in config.ts).
 *
 * Uses the standard `WixUI_InstallDir` wizard from the `WixToolset.UI.wixext`
 * extension (welcome → license → install-dir → install → finish), passed via
 * `-ext` below — see `wxsScript`'s doc comment for the UI wiring itself.
 */
async function buildMsiInstaller(opts: {
  cwd: string
  config: MurasakiConfig
  productName: string
  version: string
  bundleDir: string
  arch: Arch
  branding: WindowsBranding
}): Promise<string | null> {
  const { cwd, config, productName, version, bundleDir, arch, branding } = opts

  const wix = resolveWix()
  if (!wix) {
    process.stdout.write(
      `\n${warn('installer: wix not found — skipping the .msi installer (expected on macOS/Linux; WiX is Windows-only).')}\n` +
        `${dim('  install: dotnet tool install --global wix')}\n\n`,
    )
    return null
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
    // WixUI_InstallDir's license page always needs an RTF; fall back to a
    // generated placeholder when `branding.license` is unset (see the
    // function's doc comment).
    const licenseRtf = await resolveMsiLicenseRtf(branding, wxsDir)

    const wxsPath = join(wxsDir, 'installer.wxs')
    await writeFile(
      wxsPath,
      await wxsScript({
        appId: config.appId,
        displayName: productName,
        description: config.description,
        version: wixVersion,
        publisher,
        upgradeCode,
        productCode,
        bundleDir,
        branding,
        licenseRtf,
        associations: resolveAssociations(config),
      }),
    )

    const result = spawnSync(
      wix,
      ['build', wxsPath, '-arch', wixArch, '-ext', 'WixToolset.UI.wixext', '-out', msiPath],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) {
      process.stdout.write(
        `\n${warn('installer: wix build failed, skipping the .msi installer:')}\n${dim((result.stderr || result.stdout).trim())}\n\n`,
      )
      return null
    }

    process.stdout.write(`\n${success(`installer written  ${dim(msiPath)}`)}\n\n`)
    return msiPath
  } finally {
    await rm(wxsDir, { recursive: true, force: true })
  }
}

/**
 * Generates the `.wxs` (WiX v4) source, wired up with the standard
 * `WixUI_InstallDir` wizard from `WixToolset.UI.wixext` (referenced via the
 * `ui:` namespace/`<ui:WixUI>` element — the extension itself is passed to
 * `wix build` via `-ext`, see `buildMsiInstaller`): welcome → license →
 * install-dir → install → finish, matching the NSIS installer's flow.
 * `licenseRtf` backs the license page (`WixUILicenseRtf`, always set — see
 * `resolveMsiLicenseRtf`); `branding.banner`/`branding.sidebar` back
 * `WixUIBannerBmp`/`WixUIDialogBmp` when configured, else the extension's own
 * plain default imagery is used; `branding.icon` backs `ARPPRODUCTICON` (Add/
 * Remove Programs) when configured.
 */
export function wixAssociationComponents(opts: {
  appId: string
  displayName: string
  description?: string
  associations: ResolvedAssociations
}): { components: string; featureRefs: string } {
  const { appId, displayName, description, associations } = opts
  if (associations.protocols.length === 0 && associations.files.length === 0) {
    return { components: '', featureRefs: '' }
  }
  const components: string[] = []
  const ids: string[] = []
  const appKey = windowsProgId(appId, 'Application')
  const capabilitiesKey = `Software\\${appKey}\\Capabilities`
  const registeredName = `${displayName} (${appId})`
  const applicationDescription = description?.trim() || `${displayName} desktop application`
  const formattedDisplayName = escapeXmlAttr(escapeMsiFormatted(displayName))
  const command = `&quot;[INSTALLFOLDER]${formattedDisplayName}.exe&quot; &quot;%1&quot;`

  associations.protocols.forEach((protocol) => {
    const id = associationWixId('Protocol', protocol.scheme)
    ids.push(id)
    const progId = windowsProgId(appId, `Url.${protocol.scheme}`)
    const progIdKey = `Software\\Classes\\${progId}`
    components.push(`    <Component Id="${id}" Directory="INSTALLFOLDER" Guid="*">
      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(progIdKey)}" Type="string" Value="URL:${escapeXmlAttr(protocol.name)}" KeyPath="yes" />
      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(progIdKey)}" Name="URL Protocol" Type="string" Value="" />
      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(progIdKey)}\\DefaultIcon" Type="string" Value="[INSTALLFOLDER]${formattedDisplayName}.exe,0" />
      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(progIdKey)}\\shell\\open\\command" Type="string" Value="${command}" />
    </Component>`)
  })

  associations.files.forEach((file) => {
    file.extensions.forEach((extension) => {
      const id = associationWixId('File', extension)
      ids.push(id)
      const progId = windowsProgId(appId, extension)
      const dotExtension = `.${extension}`
      components.push(`    <Component Id="${id}" Directory="INSTALLFOLDER" Guid="*">
      <RegistryValue Root="HKLM" Key="Software\\Classes\\${dotExtension}\\OpenWithProgids" Name="${escapeXmlAttr(progId)}" Type="string" Value="" KeyPath="yes" />
      <RegistryValue Root="HKLM" Key="Software\\Classes\\${escapeXmlAttr(progId)}" Type="string" Value="${escapeXmlAttr(file.description)}" />
      <RegistryValue Root="HKLM" Key="Software\\Classes\\${escapeXmlAttr(progId)}\\DefaultIcon" Type="string" Value="[INSTALLFOLDER]${formattedDisplayName}.exe,0" />
      <RegistryValue Root="HKLM" Key="Software\\Classes\\${escapeXmlAttr(progId)}\\shell\\open\\command" Type="string" Value="${command}" />
    </Component>`)
    })
  })

  const capabilitiesId = associationWixId('Capabilities', appId)
  ids.push(capabilitiesId)
  const capabilityValues = [
    ...associations.protocols.map((protocol) =>
      `      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(capabilitiesKey)}\\URLAssociations" Name="${escapeXmlAttr(protocol.scheme)}" Type="string" Value="${escapeXmlAttr(windowsProgId(appId, `Url.${protocol.scheme}`))}" />`),
    ...associations.files.flatMap((file) => file.extensions.map((extension) =>
      `      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(capabilitiesKey)}\\FileAssociations" Name=".${escapeXmlAttr(extension)}" Type="string" Value="${escapeXmlAttr(windowsProgId(appId, extension))}" />`)),
    ...associations.files.flatMap((file) => file.mimeType
      ? [`      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(capabilitiesKey)}\\MIMEAssociations" Name="${escapeXmlAttr(file.mimeType)}" Type="string" Value="${escapeXmlAttr(windowsProgId(appId, file.extensions[0]))}" />`]
      : []),
  ].join('\n')
  components.push(`    <Component Id="${capabilitiesId}" Directory="INSTALLFOLDER" Guid="*">
      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(capabilitiesKey)}" Name="ApplicationDescription" Type="string" Value="${escapeXmlAttr(applicationDescription)}" KeyPath="yes" />
      <RegistryValue Root="HKLM" Key="${escapeXmlAttr(capabilitiesKey)}" Name="ApplicationName" Type="string" Value="${escapeXmlAttr(registeredName)}" />
${capabilityValues}
      <RegistryValue Root="HKLM" Key="Software\\RegisteredApplications" Name="${escapeXmlAttr(registeredName)}" Type="string" Value="${escapeXmlAttr(capabilitiesKey)}" />
    </Component>`)

  return {
    components: components.join('\n\n'),
    featureRefs: ids.map((id) => `      <ComponentRef Id="${id}" />`).join('\n'),
  }
}

function associationWixId(prefix: string, value: string): string {
  return `Association${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

export async function wxsScript(opts: {
  appId: string
  displayName: string
  description?: string
  version: string
  publisher: string
  upgradeCode: string
  productCode: string
  bundleDir: string
  branding: WindowsBranding
  licenseRtf: string
  associations: ResolvedAssociations
}): Promise<string> {
  const { appId, displayName, description, version, publisher, upgradeCode, productCode, bundleDir, branding, licenseRtf, associations } = opts
  const name = escapeXmlAttr(displayName)
  const manufacturer = escapeXmlAttr(publisher)

  const { dirTree, files } = await collectWxsTree(bundleDir)
  const dirTreeXml = renderWxsDirTree(dirTree, '        ')
  const filesXml = renderWxsFileComponents(files)
  const associationComponents = wixAssociationComponents({ appId, displayName, description, associations })
  const hasAssociations = associations.protocols.length > 0 || associations.files.length > 0
  const launcherFile = files.find((file) =>
    file.parentId === 'INSTALLFOLDER'
      && basename(file.absPath).toLowerCase() === `${displayName}.exe`.toLowerCase())
  if (hasAssociations && !launcherFile) {
    throw new Error(`murasaki: MSI bundle is missing ${displayName}.exe`)
  }
  const associationNotifyXml = !hasAssociations || !launcherFile ? '' : `
    <CustomAction Id="ManageAssociationsInstall" FileRef="${launcherFile.id}" ExeCommand="--murasaki-associations-install" Execute="deferred" Impersonate="no" Return="check" />
    <CustomAction Id="ManageAssociationsUninstall" FileRef="${launcherFile.id}" ExeCommand="--murasaki-associations-uninstall" Execute="deferred" Impersonate="no" Return="check" />
    <InstallExecuteSequence>
      <Custom Action="ManageAssociationsInstall" After="WriteRegistryValues" Condition="NOT REMOVE~=&quot;ALL&quot;" />
      <Custom Action="ManageAssociationsUninstall" Before="RemoveFiles" Condition="REMOVE~=&quot;ALL&quot;" />
    </InstallExecuteSequence>`

  const iconXml = branding.icon
    ? `\n    <Icon Id="ProductIcon" SourceFile="${escapeXmlAttr(branding.icon)}" />\n    <Property Id="ARPPRODUCTICON" Value="ProductIcon" />`
    : ''

  const uiVariablesXml = [
    `    <WixVariable Id="WixUILicenseRtf" Value="${escapeXmlAttr(licenseRtf)}" />`,
    branding.banner
      ? `    <WixVariable Id="WixUIBannerBmp" Value="${escapeXmlAttr(branding.banner)}" />`
      : '',
    branding.sidebar
      ? `    <WixVariable Id="WixUIDialogBmp" Value="${escapeXmlAttr(branding.sidebar)}" />`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs" xmlns:ui="http://wixtoolset.org/schemas/v4/wxs/ui">
  <Package
    Name="${name}"
    Manufacturer="${manufacturer}"
    Version="${version}"
    UpgradeCode="${upgradeCode}"
    ProductCode="${productCode}"
    Scope="perMachine">

    <MajorUpgrade DowngradeErrorMessage="A newer version of [ProductName] is already installed." />
    <MediaTemplate EmbedCab="yes" CompressionLevel="high" />
${iconXml}

    <ui:WixUI Id="WixUI_InstallDir" InstallDirectory="INSTALLFOLDER" />
${uiVariablesXml}
${associationNotifyXml}

    <Feature Id="Main" Title="${name}" Level="1">
      <ComponentGroupRef Id="Files" />
      <ComponentRef Id="StartMenuShortcut" />
${associationComponents.featureRefs}
    </Feature>

    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="${name}">
${dirTreeXml}
      </Directory>
    </StandardDirectory>

    <StandardDirectory Id="ProgramMenuFolder">
      <Directory Id="AppProgramMenuFolder" Name="${name}" />
    </StandardDirectory>

    <ComponentGroup Id="Files">
${filesXml}
    </ComponentGroup>

${associationComponents.components}

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

/** One directory under `INSTALLFOLDER` — `children` nest the same way on disk. */
interface WxsDirNode {
  id: string
  name: string
  children: WxsDirNode[]
}

/** One `<Component>`/`<File>` pair — `parentId` is `INSTALLFOLDER` or a `WxsDirNode.id`. */
interface WxsFileEntry {
  id: string
  parentId: string
  absPath: string
}

/**
 * Recursively walks `bundleDir`, building the `<Directory>` tree WiX needs
 * authored inline under `INSTALLFOLDER` (unlike `<Component>`, `<Directory>`
 * has no by-reference form — see `wxsScript`'s doc comment on why the
 * `<Files Include>` shorthand that would've avoided this walk doesn't work
 * in WiX v4.0.6) alongside a flat list of every real file, each already
 * pointing at its parent directory's Id.
 */
async function collectWxsTree(
  bundleDir: string,
): Promise<{ dirTree: WxsDirNode[]; files: WxsFileEntry[] }> {
  const files: WxsFileEntry[] = []

  async function walk(absDir: string, relDir: string, parentId: string): Promise<WxsDirNode[]> {
    const entries = (await readdir(absDir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    const nodes: WxsDirNode[] = []
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      const abs = join(absDir, entry.name)
      if (entry.isDirectory()) {
        const id = wxsId('dir', rel)
        const children = await walk(abs, rel, id)
        nodes.push({ id, name: entry.name, children })
      } else if (entry.isFile()) {
        files.push({ id: wxsId('f', rel), parentId, absPath: abs })
      }
      // Anything else (symlinks, …) isn't expected in a staged bundle —
      // skipped rather than erroring, same "best-effort" posture as the rest
      // of this file's degrade-gracefully conventions.
    }
    return nodes
  }

  const dirTree = await walk(bundleDir, '', 'INSTALLFOLDER')
  return { dirTree, files }
}

/**
 * A WiX Id derived from `relPath` (`kind` is `"dir"` or `"f"`): sanitized to
 * WiX's allowed charset (`[A-Za-z0-9_.]`, starting with a letter/underscore)
 * plus an 8-char hash of the *full* relative path so same-named files/dirs
 * in different parents can't collide after sanitization truncates/mangles
 * their names.
 */
function wxsId(kind: 'dir' | 'f', relPath: string): string {
  const hash = createHash('sha256').update(relPath).digest('hex').slice(0, 8)
  const base = relPath
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9_.]/g, '_')
    .slice(0, 40)
  return `${kind}_${base}_${hash}`
}

/** Renders the `<Directory>` tree nested under `INSTALLFOLDER`, indented `indent` deep, 2 spaces per level — mirrors this file's existing indentation convention. */
function renderWxsDirTree(nodes: WxsDirNode[], indent: string): string {
  return nodes
    .map((n) => {
      const name = escapeXmlAttr(n.name)
      if (n.children.length === 0) return `${indent}<Directory Id="${n.id}" Name="${name}" />`
      return (
        `${indent}<Directory Id="${n.id}" Name="${name}">\n` +
        `${renderWxsDirTree(n.children, `${indent}  `)}\n` +
        `${indent}</Directory>`
      )
    })
    .join('\n')
}

/** Renders one `<Component Guid="*">`/`<File>` pair per file — `Guid="*"` lets WiX derive a stable GUID from each component's (single, so implicit) key path, same technique the `StartMenuShortcut` component above already uses. */
function renderWxsFileComponents(files: WxsFileEntry[]): string {
  return files
    .map(
      (f) =>
        `      <Component Directory="${f.parentId}" Guid="*">\n` +
        `        <File Id="${f.id}" Source="${escapeXmlAttr(f.absPath)}" />\n` +
        `      </Component>`,
    )
    .join('\n')
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Escape literal brackets in Windows Installer Formatted fields. */
function escapeMsiFormatted(s: string): string {
  return Array.from(s, (character) => {
    if (character === '[') return '[\\[]'
    if (character === ']') return '[\\]]'
    return character
  }).join('')
}

// ── Linux: .deb ─────────────────────────────────────────────────────────

/**
 * Linux counterpart of the darwin `.dmg`/win32 NSIS+MSI paths above:
 * (re-)bundles via `bundle` (same re-bundle-by-default / `--no-build`
 * convention), then packs the just-staged `dist/bundle/<productName>.AppDir/`
 * `usr/` tree into `dist/<debName>_<version>_<debArch>.deb` — a pure-Node
 * `ar`/ustar-tar writer (see deb.ts), no `dpkg-deb` dependency, so this
 * cross-builds from macOS/CI the same way `bundle --target linux-*` already
 * does. The `.AppImage` (produced by `bundle` itself, see bundle.ts's
 * `bundleLinux`) is left as the standalone/self-updating distribution
 * channel; this `.deb` is package-manager-owned and never carries update
 * logic of its own (see release.ts's manifest scan, which only ever looks
 * for `.AppImage` payloads).
 */
async function installerLinux(
  argv: string[],
  cwd: string,
  config: MurasakiConfig,
  arch: Arch,
): Promise<void> {
  const productName = config.productName
  const version = config.version ?? '0.0.0'
  const appDir = resolve(cwd, 'dist/bundle', `${productName}.AppDir`)

  // Same re-bundle-by-default / --no-build convention as the darwin/win32 paths.
  const skipBuild = argv.includes('--no-build')
  if (!skipBuild || !existsSync(appDir)) await bundle(argv)

  await mkdir(resolve(cwd, 'dist'), { recursive: true })

  const debName = sanitizeDebName(productName)
  const debArch = arch === 'arm64' ? 'arm64' : 'amd64'
  const debPath = resolve(cwd, 'dist', `${debName}_${version}_${debArch}.deb`)
  await rm(debPath, { force: true })

  const dataEntries = await collectDebTarEntries(join(appDir, 'usr'), 'usr')
  const dataTarGz = gzipSync(writeUstarTar(dataEntries))

  const maintainer = sanitizeDebControlValue(
    config.authors && config.authors.length > 0 ? config.authors.join(', ') : config.appId,
  )
  const description = sanitizeDebControlValue(
    config.description?.trim() || `${productName} desktop application`,
  )
  const control = debControlFile({ debName, version, debArch, maintainer, description })
  const md5sums = debMd5sumsFile(dataEntries)

  const controlEntries: TarEntry[] = [
    { path: '.', type: 'directory', mode: 0o755 },
    { path: './control', type: 'file', mode: 0o644, data: Buffer.from(control, 'utf8') },
    { path: './md5sums', type: 'file', mode: 0o644, data: Buffer.from(md5sums, 'utf8') },
    { path: './postinst', type: 'file', mode: 0o755, data: Buffer.from(DEB_MAINTAINER_SCRIPT, 'utf8') },
    { path: './postrm', type: 'file', mode: 0o755, data: Buffer.from(DEB_MAINTAINER_SCRIPT, 'utf8') },
  ]
  const controlTarGz = gzipSync(writeUstarTar(controlEntries))

  const deb = writeArArchive([
    { name: 'debian-binary', data: Buffer.from('2.0\n', 'ascii') },
    { name: 'control.tar.gz', data: controlTarGz },
    { name: 'data.tar.gz', data: dataTarGz },
  ])
  await writeFile(debPath, deb)

  process.stdout.write(`\n${success(`installer written  ${dim(debPath)}`)}\n\n`)
}

/**
 * Debian package names: lowercase letters/digits/`+`/`.`/`-`, starting with
 * an alphanumeric (Debian Policy §5.6.7) — derived from `productName` with
 * the same "collapse to a separator, fall back to a generic name" convention
 * `sanitizeAssemblyName`/`sanitizeLinuxExecName` use in bundle.ts (kept as
 * its own copy here since dpkg's charset is stricter — no underscore, and
 * lowercase-only — matching this file's existing precedent of not sharing
 * per-installer-format sanitizers, e.g. `resolveWindowsPublisher`'s copy).
 */
export function sanitizeDebName(productName: string): string {
  const sanitized = productName.toLowerCase().replace(/[^a-z0-9+.-]+/g, '-').replace(/^[-.+]+/, '')
  return sanitized.length > 0 ? sanitized : 'murasaki-app'
}

/** Strips embedded newlines from a control-file field value (Maintainer/Description), which would otherwise corrupt the single-line `Key: value` format. */
function sanitizeDebControlValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/** `control.tar.gz`'s `control` file — Package/Version/Architecture/Maintainer/Description plus the fixed `Section: utils` / `Priority: optional` murasaki always declares. */
export function debControlFile(opts: {
  debName: string
  version: string
  debArch: string
  maintainer: string
  description: string
}): string {
  const { debName, version, debArch, maintainer, description } = opts
  return `Package: ${debName}
Version: ${version}
Architecture: ${debArch}
Maintainer: ${maintainer}
Description: ${description}
Section: utils
Priority: optional
`
}

/**
 * `md5sum`-format checksums of every regular file in `entries` (directories
 * excluded), path relative to the tar root without the leading `./` — the
 * format `dpkg` itself expects at `control.tar.gz`'s `md5sums`.
 */
export function debMd5sumsFile(entries: TarEntry[]): string {
  return entries
    .filter((entry) => entry.type === 'file')
    .map(
      (entry) =>
        `${createHash('md5').update(entry.data ?? Buffer.alloc(0)).digest('hex')}  ${entry.path.replace(/^\.\//, '')}\n`,
    )
    .join('')
}

/** Shared by `postinst`/`postrm`: best-effort desktop-database/icon-cache refresh, guarded so a minimal system without either tool still installs/removes cleanly. */
const DEB_MAINTAINER_SCRIPT = `#!/bin/sh
set -e

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -f /usr/share/icons/hicolor || true
fi

exit 0
`

/**
 * Recursively walks `absRoot` (the AppDir's `usr/` directory) into ustar
 * `TarEntry` objects rooted at `./<labelRoot>` (e.g. `./usr`, `./usr/bin`,
 * `./usr/bin/<execName>`, …) — the `./`-prefixed path convention real
 * `dpkg-deb`-built `data.tar.gz` archives use. Regular files keep whatever
 * executable bit they already have on disk (755 for the launcher binary/
 * Node runtime, 644 for everything else); directories are always 755.
 */
async function collectDebTarEntries(absRoot: string, labelRoot: string): Promise<TarEntry[]> {
  const entries: TarEntry[] = []

  async function walk(absDir: string, relPath: string): Promise<void> {
    const dirStat = await stat(absDir)
    entries.push({
      path: `./${relPath}`,
      type: 'directory',
      mode: 0o755,
      mtime: Math.floor(dirStat.mtimeMs / 1000),
    })

    const children = (await readdir(absDir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const child of children) {
      const absChild = join(absDir, child.name)
      const relChild = `${relPath}/${child.name}`
      if (child.isDirectory()) {
        await walk(absChild, relChild)
      } else if (child.isFile()) {
        const fileStat = await stat(absChild)
        const executable = (fileStat.mode & 0o111) !== 0
        entries.push({
          path: `./${relChild}`,
          type: 'file',
          mode: executable ? 0o755 : 0o644,
          mtime: Math.floor(fileStat.mtimeMs / 1000),
          data: await readFile(absChild),
        })
      }
      // Symlinks aren't expected under an AppDir's usr/ tree (the AppImage-
      // specific .DirIcon symlink lives at the AppDir root, outside usr/) —
      // skipped rather than erroring, matching this file's existing
      // best-effort posture for unexpected entry kinds (see collectWxsTree).
    }
  }

  await walk(absRoot, labelRoot)
  return entries
}
