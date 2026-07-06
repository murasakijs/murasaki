import { resolve, join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, cp, copyFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { success, warn, error, dim, unsignedNote } from './brand.js'
import bundle from './bundle.js'
import type { MurasakiConfig } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DEFAULT_WINDOW = { width: 640, height: 420 }
const DEFAULT_ICON_SIZE = 128

/**
 * Wrap the `.app` produced by `bundle` into a drag-to-install `.dmg`, via
 * `hdiutil` — the same tool Finder uses under the hood, so no extra
 * dependency is needed on macOS.
 *
 * Produces a styled DMG (background image, fixed window, positioned icons —
 * app on the left, Applications on the right) using the classic
 * create-rw / attach / osascript / detach / convert-to-UDZO sequence. If the
 * `osascript` styling step fails for any reason, falls back to a plain
 * `hdiutil create -format UDZO` so `murasaki installer` never hard-fails.
 */
export default async function installer(argv: string[]) {
  const cwd = process.cwd()

  if (process.platform !== 'darwin') {
    process.stdout.write(`\n${warn('installer: only macOS (.dmg) is supported right now.')}\n\n`)
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

  const config = await loadUserConfig(cwd)
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
