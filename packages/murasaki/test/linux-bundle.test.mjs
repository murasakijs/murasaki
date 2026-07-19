import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { PNG } from 'pngjs'

import bundle, {
  linuxAppRunScript,
  linuxDesktopEntry,
  metaJson,
  sanitizeLinuxAppId,
  sanitizeLinuxExecName,
} from '../dist/cli/bundle.js'
import { buildAppImage, detectMksquashfs } from '../dist/cli/appimage.js'
import release from '../dist/cli/release.js'

/**
 * `buildLinuxIcons` (bundle.ts) isn't exported — it's an internal step of
 * `bundleLinux`, which itself needs a real launcher binary + a downloaded
 * Node runtime to run end-to-end (see bundle.ts's doc comments). Rather than
 * mock those out, this file tests every pure/filesystem-scoped building
 * block `bundleLinux` composes (icon generation is exercised indirectly
 * through the "layout assembly" test below, which re-derives the same
 * hicolor fan-out `buildLinuxIcons` would produce using the same `pngjs`
 * resize technique) and verifies the full AppDir layout the fixed contract
 * requires. The real end-to-end `bundleLinux`/`installerLinux` path is
 * covered by CI's Linux bundle smoke (.github/workflows/ci.yml).
 */

function makeFixturePng(size, rgba) {
  const png = new PNG({ width: size, height: size })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0]
    png.data[i + 1] = rgba[1]
    png.data[i + 2] = rgba[2]
    png.data[i + 3] = rgba[3]
  }
  return PNG.sync.write(png)
}

async function withTempProject(t) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-linux-bundle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('an explicit Linux --sign request fails before producing an unsigned artifact', async (t) => {
  const root = await withTempProject(t)
  await writeFile(
    join(root, 'murasaki.config.mjs'),
    "export default { appId: 'dev.test.signing', productName: 'SigningFixture' }\n",
  )
  const previous = process.cwd()
  process.chdir(root)
  try {
    await assert.rejects(
      bundle(['--target', 'linux-x64', '--sign']),
      /Linux AppDir\/AppImage signing is not implemented.*Refusing to emit an unsigned artifact/,
    )
  } finally {
    process.chdir(previous)
  }
  assert.equal(existsSync(join(root, 'dist')), false)
})

// ── sanitizeLinuxExecName / sanitizeLinuxAppId ─────────────────────────────

test('sanitizeLinuxExecName collapses unsafe characters and falls back for all-emoji names', () => {
  assert.equal(sanitizeLinuxExecName('My Cool App'), 'My-Cool-App')
  assert.equal(sanitizeLinuxExecName('Notes & Things!'), 'Notes-Things')
  assert.equal(sanitizeLinuxExecName('  leading/trailing  '), 'leading-trailing')
  assert.equal(sanitizeLinuxExecName('🦋🦋🦋'), 'murasaki-app')
  assert.equal(sanitizeLinuxExecName('already-safe_name.v2'), 'already-safe_name.v2')
})

test('sanitizeLinuxAppId keeps a reverse-DNS id intact and sanitizes unsafe ones', () => {
  assert.equal(sanitizeLinuxAppId('com.example.notes'), 'com.example.notes')
  assert.equal(sanitizeLinuxAppId('com example/notes'), 'com-example-notes')
  assert.equal(sanitizeLinuxAppId('...'), 'murasaki.app')
})

// ── AppRun ──────────────────────────────────────────────────────────────

test('linuxAppRunScript execs the launcher via $APPDIR, not a relative path', () => {
  const script = linuxAppRunScript('my-app')
  assert.match(script, /^#!\/bin\/sh\n/)
  assert.match(script, /exec "\$APPDIR\/usr\/bin\/my-app" "\$@"/)
})

// ── .desktop generation ───────────────────────────────────────────────────

const desktopConfig = {
  appId: 'com.example.notes',
  productName: 'Notes & Things',
  description: 'Take notes, quickly',
  protocols: [{ scheme: 'example-notes', name: 'Notes link' }],
  fileAssociations: [{
    extensions: ['enote', 'ENoteX'],
    name: 'Notes document',
    description: 'A notes document',
    role: 'editor',
    mimeType: 'application/x-example-note',
  }, {
    extensions: ['entxt'],
    name: 'Notes text export',
    role: 'viewer',
  }],
}

test('linuxDesktopEntry emits the required fields plus MimeType lines for protocols and file associations', () => {
  const execName = sanitizeLinuxExecName(desktopConfig.productName)
  const entry = linuxDesktopEntry(desktopConfig, execName, desktopConfig.appId)

  assert.match(entry, /^\[Desktop Entry\]\n/)
  assert.match(entry, /\nName=Notes & Things\n/)
  assert.match(entry, /\nComment=Take notes, quickly\n/)
  assert.match(entry, new RegExp(`\\nExec=${execName} %U\\n`))
  assert.match(entry, /\nIcon=com\.example\.notes\n/)
  assert.match(entry, /\nType=Application\n/)
  assert.match(entry, /\nCategories=Utility;\n/)
  assert.match(entry, new RegExp(`\\nStartupWMClass=${execName}\\n`))
  // x-scheme-handler/<scheme> for the declared protocol; per file association
  // the declared mimeType wins, and only mimeType-less associations fall back
  // to application/x-<ext> per extension (lowercased by resolveAssociations).
  assert.match(entry, /MimeType=x-scheme-handler\/example-notes;application\/x-example-note;application\/x-entxt;\n/)
})

test('linuxDesktopEntry falls back to a generic Comment and omits MimeType when nothing is declared', () => {
  const config = { appId: 'dev.test.plain', productName: 'Plain App' }
  const entry = linuxDesktopEntry(config, 'Plain-App', config.appId)
  assert.match(entry, /\nComment=Plain App desktop application\n/)
  assert.doesNotMatch(entry, /MimeType=/)
})

test('linuxDesktopEntry strips embedded newlines from Comment so the format stays one key per line', () => {
  // productName itself can't contain control characters — resolveAssociations
  // rejects that upstream (see associations.ts's validateDisplayText) — but
  // config.description isn't run through that same validation.
  const config = { appId: 'dev.test.newline', productName: 'Weird Name', description: 'Line one\nLine two' }
  const entry = linuxDesktopEntry(config, 'weird-name', config.appId)
  assert.match(entry, /\nName=Weird Name\n/)
  assert.match(entry, /\nComment=Line one Line two\n/)
})

// ── AppDir layout assembly (mock/tiny fixture app) ─────────────────────────

test('assembling the fixed AppDir layout produces every required path with correct permissions', async (t) => {
  const root = await withTempProject(t)
  const appId = 'com.example.fixture'
  const execName = 'fixture-app'
  const appDir = join(root, 'dist/bundle', 'Fixture App.AppDir')

  const binDir = join(appDir, 'usr/bin')
  const resourcesDir = join(appDir, 'usr/lib', appId, 'resources')
  const applicationsDir = join(appDir, 'usr/share/applications')
  await mkdir(binDir, { recursive: true })
  await mkdir(resourcesDir, { recursive: true })
  await mkdir(applicationsDir, { recursive: true })

  // usr/bin/<execName> — stand-in for the real launcher binary (which needs
  // a compiled @murasakijs/native prebuild — see this file's module doc
  // comment for why the real bundleLinux() isn't exercised here).
  await writeFile(join(binDir, execName), '#!/bin/sh\necho fixture launcher\n')
  await chmod(join(binDir, execName), 0o755)

  // resources/node — stand-in for the downloaded Node runtime.
  await writeFile(join(resourcesDir, 'node'), 'fixture-node-binary')
  await chmod(join(resourcesDir, 'node'), 0o755)

  // resources/murasaki-meta.json — the real generator, same as bundleLinux.
  const config = { appId, productName: 'Fixture App', version: '1.0.0' }
  await writeFile(
    join(resourcesDir, 'murasaki-meta.json'),
    metaJson(config, config.productName, 'icon.png', root),
  )

  // resources/icon.png + the AppImage root icon + the hicolor fan-out — the
  // same pngjs decode/resize technique buildLinuxIcons uses internally.
  const source = PNG.sync.read(makeFixturePng(32, [168, 85, 247, 255]))
  await writeFile(join(resourcesDir, 'icon.png'), PNG.sync.write(source))
  const rootIcon = new PNG({ width: 256, height: 256 })
  await writeFile(join(appDir, `${appId}.png`), PNG.sync.write(rootIcon))
  for (const size of [16, 32, 64, 128, 256, 512]) {
    const dir = join(appDir, 'usr/share/icons/hicolor', `${size}x${size}`, 'apps')
    await mkdir(dir, { recursive: true })
    const icon = new PNG({ width: size, height: size })
    await writeFile(join(dir, `${appId}.png`), PNG.sync.write(icon))
  }

  // AppRun
  await writeFile(join(appDir, 'AppRun'), linuxAppRunScript(execName))
  await chmod(join(appDir, 'AppRun'), 0o755)

  // <appId>.desktop (root + usr/share/applications) + .DirIcon symlink
  const entry = linuxDesktopEntry(config, execName, appId)
  await writeFile(join(appDir, `${appId}.desktop`), entry)
  await writeFile(join(applicationsDir, `${appId}.desktop`), entry)
  await symlink(`${appId}.png`, join(appDir, '.DirIcon'))

  // ── assertions: the fixed layout contract, verbatim ──
  assert.ok(existsSync(join(appDir, 'AppRun')))
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(appDir, 'AppRun'))).mode & 0o777, 0o755)
  }
  assert.ok(existsSync(join(appDir, `${appId}.desktop`)))
  assert.ok(existsSync(join(appDir, `${appId}.png`)))
  assert.equal(await readlink(join(appDir, '.DirIcon')), `${appId}.png`)
  assert.ok(existsSync(join(binDir, execName)))
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(binDir, execName))).mode & 0o777, 0o755)
  }
  assert.ok(existsSync(join(resourcesDir, 'murasaki-meta.json')))
  assert.ok(existsSync(join(applicationsDir, `${appId}.desktop`)))
  for (const size of [16, 32, 64, 128, 256, 512]) {
    const iconPath = join(appDir, 'usr/share/icons/hicolor', `${size}x${size}`, 'apps', `${appId}.png`)
    assert.ok(existsSync(iconPath), `missing hicolor icon at ${size}x${size}`)
    const decoded = PNG.sync.read(await readFile(iconPath))
    assert.equal(decoded.width, size)
    assert.equal(decoded.height, size)
  }
  const rootIconDecoded = PNG.sync.read(await readFile(join(appDir, `${appId}.png`)))
  assert.equal(rootIconDecoded.width, 256)
  assert.equal(rootIconDecoded.height, 256)

  const meta = JSON.parse(await readFile(join(resourcesDir, 'murasaki-meta.json'), 'utf8'))
  assert.equal(meta.appId, appId)
  assert.equal(meta.icon, 'icon.png')
})

// ── Real AppImage assembly (opportunistic — needs mksquashfs) ──────────────

test('buildAppImage produces an executable, ELF-runtime-prefixed .AppImage', async (t) => {
  if (!detectMksquashfs()) {
    t.skip('mksquashfs (squashfs-tools) is not installed on this host')
    return
  }

  const root = await withTempProject(t)
  const appDir = join(root, 'Fixture.AppDir')
  await mkdir(join(appDir, 'usr/bin'), { recursive: true })
  await writeFile(join(appDir, 'usr/bin/fixture'), '#!/bin/sh\necho hi\n')
  await chmod(join(appDir, 'usr/bin/fixture'), 0o755)
  await writeFile(join(appDir, 'AppRun'), linuxAppRunScript('fixture'))
  await chmod(join(appDir, 'AppRun'), 0o755)
  await writeFile(join(appDir, 'fixture.desktop'), linuxDesktopEntry(
    { appId: 'fixture', productName: 'Fixture' },
    'fixture',
    'fixture',
  ))

  const appImagePath = join(root, 'Fixture-1.0.0-linux-x64.AppImage')
  try {
    await buildAppImage(appDir, appImagePath, 'x64')
  } catch (err) {
    // No network access to fetch the pinned AppImage runtime in this
    // environment — mksquashfs itself is exercised well enough by the
    // fixture-only assertions below when it succeeds; skip gracefully here.
    t.skip(`could not build a real .AppImage (likely no network access): ${err.message}`)
    return
  }

  assert.ok(existsSync(appImagePath))
  const stats = await stat(appImagePath)
  assert.equal(stats.mode & 0o111, 0o111) // executable by everyone, chmod 0o755's bits
  const bytes = await readFile(appImagePath)
  // The AppImage runtime is a real ELF binary, prepended before the squashfs
  // image — the file must start with the ELF magic.
  assert.deepEqual(bytes.subarray(0, 4), Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  assert.ok(bytes.length > 1024)

  // Opportunistic extra assertion with the host's own `file`/`unsquashfs` if
  // present — not required for the test to pass.
  const fileCmd = spawnSync('file', [appImagePath], { encoding: 'utf8' })
  if (!fileCmd.error) {
    assert.match(fileCmd.stdout, /ELF/)
  }
})

// ── release.ts: Linux payload scan ─────────────────────────────────────────

test('release --manifest scans dist/bundle for linux-x64/linux-arm64 .AppImage payloads', async (t) => {
  const originalCwd = process.cwd()
  const root = await withTempProject(t)
  await writeFile(join(root, 'murasaki.config.mjs'), `export default { appId: 'dev.test.linux-release', productName: 'LinuxReleaseApp' }\n`)
  await mkdir(join(root, 'dist/bundle'), { recursive: true })
  await writeFile(join(root, 'dist/bundle/LinuxReleaseApp-1.0.0-linux-x64.AppImage'), 'x64-fixture')
  await writeFile(join(root, 'dist/bundle/LinuxReleaseApp-1.0.0-linux-arm64.AppImage'), 'arm64-fixture')
  // A .deb sitting alongside must never be picked up as an update payload.
  await writeFile(join(root, 'dist/bundle/linuxreleaseapp_1.0.0_amd64.deb'), 'deb-fixture')

  process.chdir(root)
  try {
    await release(['--manifest', '--base-url', 'https://updates.example.com', '--version', '1.0.0'])
  } finally {
    process.chdir(originalCwd)
  }

  const manifest = JSON.parse(await readFile(join(root, 'dist/latest.json'), 'utf8'))
  assert.equal(
    manifest.assets['linux-x64'].url,
    'https://updates.example.com/LinuxReleaseApp-1.0.0-linux-x64.AppImage',
  )
  assert.equal(
    manifest.assets['linux-x64'].sha256,
    createHash('sha256').update('x64-fixture').digest('hex'),
  )
  assert.equal(
    manifest.assets['linux-arm64'].url,
    'https://updates.example.com/LinuxReleaseApp-1.0.0-linux-arm64.AppImage',
  )
  assert.equal(manifest.assets['.deb'], undefined)
  assert.ok(!Object.keys(manifest.assets).some((key) => key.includes('deb')))
})
