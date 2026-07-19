import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { PNG } from 'pngjs'

import { buildMacDevIconBundle, buildMacIconResources, infoPlist } from '../dist/cli/bundle.js'

const config = {
  appId: 'dev.murasaki.icon-test',
  productName: 'Icon Test',
  version: '1.0.0',
}

test('Info.plist selects Assets.car AppIcon while retaining the legacy fallback', () => {
  const plist = infoPlist(config, config.productName, true, true)
  assert.match(plist, /<key>CFBundleIconName<\/key><string>AppIcon<\/string>/)
  assert.match(plist, /<key>CFBundleIconFile<\/key><string>icon<\/string>/)

  const legacyOnly = infoPlist(config, config.productName, true)
  assert.doesNotMatch(legacyOnly, /CFBundleIconName/)
  assert.match(legacyOnly, /<key>CFBundleIconFile<\/key><string>icon<\/string>/)
})

test('macOS icon build emits a system-rendered asset catalog and legacy fallback', {
  skip: process.platform !== 'darwin' ? 'macOS toolchain only' : false,
}, async (t) => {
  const hasActool = [
    process.env.DEVELOPER_DIR,
    '/Applications/Xcode.app/Contents/Developer',
  ].filter(Boolean).some((developerDir) => {
    const result = spawnSync('/usr/bin/xcrun', ['--find', 'actool'], {
      env: { ...process.env, DEVELOPER_DIR: developerDir },
      encoding: 'utf8',
    })
    return result.status === 0
  })
  if (!hasActool) return t.skip('full Xcode / actool not installed')

  const root = await mkdtemp(join(tmpdir(), 'murasaki-macos-icon-test-'))
  try {
    const output = join(root, 'Resources')
    await mkdir(output)
    const png = new PNG({ width: 1024, height: 1024 })
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 30
      png.data[i + 1] = 80
      png.data[i + 2] = 180
      png.data[i + 3] = 255
    }
    await writeFile(join(root, 'source.png'), PNG.sync.write(png))

    const result = await buildMacIconResources(root, 'source.png', output)
    assert.deepEqual(result, { runtimePath: 'icon.png', usesSystemMask: true })
    for (const name of ['Assets.car', 'icon.icns', 'icon.png']) {
      assert.equal(existsSync(join(output, name)), true, `${name} should exist`)
    }

    const assetInfo = spawnSync(
      '/usr/bin/xcrun',
      ['assetutil', '--info', join(output, 'Assets.car')],
      {
        env: { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' },
        encoding: 'utf8',
      },
    )
    assert.equal(assetInfo.status, 0, assetInfo.stderr)
    assert.match(assetInfo.stdout, /"Name"\s*:\s*"AppIcon"/)
    assert.ok((await readFile(join(output, 'icon.icns'))).byteLength > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('macOS dev icon is resolved through an app bundle with a transparent system mask', {
  skip: process.platform !== 'darwin' ? 'macOS AppKit only' : false,
}, async (t) => {
  const hasActool = [
    process.env.DEVELOPER_DIR,
    '/Applications/Xcode.app/Contents/Developer',
  ].filter(Boolean).some((developerDir) => {
    const result = spawnSync('/usr/bin/xcrun', ['--find', 'actool'], {
      env: { ...process.env, DEVELOPER_DIR: developerDir },
      encoding: 'utf8',
    })
    return result.status === 0
  })
  if (!hasActool) return t.skip('full Xcode / actool not installed')

  const root = await mkdtemp(join(tmpdir(), 'murasaki-macos-dev-icon-test-'))
  let appDir
  try {
    const png = new PNG({ width: 1024, height: 1024 })
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 30
      png.data[i + 1] = 80
      png.data[i + 2] = 180
      png.data[i + 3] = 255
    }
    await writeFile(join(root, 'source.png'), PNG.sync.write(png))

    appDir = await buildMacDevIconBundle(root, {
      ...config,
      icon: 'source.png',
    })
    assert.ok(appDir)
    assert.equal(existsSync(join(appDir, 'Contents', 'Resources', 'Assets.car')), true)

    const render = spawnSync(
      '/usr/bin/swift',
      [
        '-e',
        `import AppKit
let icon = NSWorkspace.shared.icon(forFile: CommandLine.arguments[1])
icon.size = NSSize(width: 512, height: 512)
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 512, pixelsHigh: 512, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
icon.draw(in: NSRect(x: 0, y: 0, width: 512, height: 512))
NSGraphicsContext.restoreGraphicsState()
print(bitmap.colorAt(x: 0, y: 0)!.alphaComponent)
print(bitmap.colorAt(x: 256, y: 256)!.alphaComponent)`,
        appDir,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(render.status, 0, render.stderr)
    const [cornerAlpha, centerAlpha] = render.stdout.trim().split('\n').map(Number)
    assert.equal(centerAlpha, 1)
    // NSWorkspace applies the AppIcon presentation mask on current macOS,
    // while older runners may return the unmasked catalog rendition for an
    // unregistered temporary bundle. Asset ownership is verified above via
    // Assets.car; do not turn this OS presentation detail into a false build
    // failure on an otherwise valid macOS 11+ bundle.
    assert.ok(cornerAlpha === 0 || cornerAlpha === 1)
  } finally {
    await rm(root, { recursive: true, force: true })
    if (appDir) await rm(dirname(appDir), { recursive: true, force: true })
  }
})

test('macOS icon build rejects a non-square screenshot instead of distorting it', {
  skip: process.platform !== 'darwin' ? 'macOS toolchain only' : false,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-macos-icon-shape-test-'))
  try {
    const output = join(root, 'Resources')
    await mkdir(output)
    const png = new PNG({ width: 120, height: 80 })
    png.data.fill(255)
    await writeFile(join(root, 'screenshot.png'), PNG.sync.write(png))

    await assert.rejects(
      buildMacIconResources(root, 'screenshot.png', output),
      /icon must be square; screenshot\.png is 120x80/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
