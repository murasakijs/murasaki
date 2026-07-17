import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  defineConfig,
  resolveStartupSystemPermissions,
  resolveWindowDeclarations,
} from '../dist/config.js'
import { infoPlist, metaJson } from '../dist/cli/bundle.js'

const base = {
  appId: 'dev.murasaki.permissions',
  productName: 'Permission Test',
}

test('macOS permission config writes usage descriptions and launch requests', () => {
  const config = defineConfig({
    ...base,
    systemPermissions: {
      macOS: {
        camera: {
          usageDescription: 'Join a video call <safely>',
          requestOnLaunch: true,
        },
        microphone: {
          usageDescription: 'Capture your voice',
        },
        screenRecording: { requestOnLaunch: true },
        accessibility: { requestOnLaunch: false },
        location: {
          usageDescription: 'Show nearby places <accurately>',
          mode: 'always',
          requestOnLaunch: true,
        },
      },
    },
  })

  assert.deepEqual(resolveStartupSystemPermissions(config), [
    'camera',
    'screenRecording',
    'location',
  ])

  const plist = infoPlist(config, config.productName, false)
  assert.match(
    plist,
    /<key>NSCameraUsageDescription<\/key><string>Join a video call &lt;safely&gt;<\/string>/,
  )
  assert.match(
    plist,
    /<key>NSMicrophoneUsageDescription<\/key><string>Capture your voice<\/string>/,
  )
  assert.match(
    plist,
    /<key>NSLocationWhenInUseUsageDescription<\/key><string>Show nearby places &lt;accurately&gt;<\/string>/,
  )
  assert.match(
    plist,
    /<key>NSLocationAlwaysAndWhenInUseUsageDescription<\/key><string>Show nearby places &lt;accurately&gt;<\/string>/,
  )

  const meta = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(meta.systemPermissionsOnLaunch, ['camera', 'screenRecording', 'location'])
})

test('location mode defaults to whenInUse and omits the always-authorization plist key', () => {
  const config = defineConfig({
    ...base,
    systemPermissions: {
      macOS: { location: { usageDescription: 'Show nearby places.' } },
    },
  })
  const plist = infoPlist(config, config.productName, false)
  assert.match(
    plist,
    /<key>NSLocationWhenInUseUsageDescription<\/key><string>Show nearby places\.<\/string>/,
  )
  assert.doesNotMatch(plist, /NSLocationAlwaysAndWhenInUseUsageDescription/)
})

test('permission config rejects missing descriptions and invalid launch flags', () => {
  assert.throws(
    () => defineConfig({
      ...base,
      systemPermissions: { macOS: { camera: { requestOnLaunch: true } } },
    }),
    /camera\.usageDescription/,
  )
  assert.throws(
    () => defineConfig({
      ...base,
      systemPermissions: { macOS: { screenRecording: { requestOnLaunch: 'yes' } } },
    }),
    /screenRecording\.requestOnLaunch/,
  )
})

test('inputMonitoring and fullDiskAccess accept requestOnLaunch like screenRecording/accessibility', () => {
  const config = defineConfig({
    ...base,
    systemPermissions: {
      macOS: {
        inputMonitoring: { requestOnLaunch: true },
        fullDiskAccess: { requestOnLaunch: true },
      },
    },
  })
  assert.deepEqual(resolveStartupSystemPermissions(config), [
    'inputMonitoring',
    'fullDiskAccess',
  ])
  assert.throws(
    () => defineConfig({
      ...base,
      systemPermissions: { macOS: { inputMonitoring: { requestOnLaunch: 'yes' } } },
    }),
    /inputMonitoring\.requestOnLaunch/,
  )
  assert.throws(
    () => defineConfig({
      ...base,
      systemPermissions: { macOS: { fullDiskAccess: { requestOnLaunch: 'yes' } } },
    }),
    /fullDiskAccess\.requestOnLaunch/,
  )
})

test('location requires a usageDescription, validates its mode enum, and defaults to whenInUse', () => {
  const config = defineConfig({
    ...base,
    systemPermissions: {
      macOS: {
        location: {
          usageDescription: 'Show nearby places.',
          mode: 'always',
          requestOnLaunch: true,
        },
      },
    },
  })
  assert.deepEqual(resolveStartupSystemPermissions(config), ['location'])

  assert.throws(
    () => defineConfig({
      ...base,
      systemPermissions: { macOS: { location: { requestOnLaunch: true } } },
    }),
    /location\.usageDescription/,
  )
  assert.throws(
    () => defineConfig({
      ...base,
      systemPermissions: {
        macOS: { location: { usageDescription: 'Show nearby places.', mode: 'sometimes' } },
      },
    }),
    /location\.mode/,
  )
  // mode defaults to 'whenInUse' — omitting it is valid.
  assert.doesNotThrow(() => defineConfig({
    ...base,
    systemPermissions: { macOS: { location: { usageDescription: 'Show nearby places.' } } },
  }))
})

test('systemPermission capability scope accepts the new permission kinds and rejects unknown ones', () => {
  const capabilities = [
    {
      permission: 'systemPermission:request',
      allow: { permissions: ['inputMonitoring', 'location', 'fullDiskAccess'] },
    },
  ]
  const resolved = resolveWindowDeclarations({ capabilities })
  assert.deepEqual(resolved[0].capabilities, capabilities)

  assert.throws(
    () => resolveWindowDeclarations({
      capabilities: [{ permission: 'systemPermission:request', allow: { permissions: ['bogusKind'] } }],
    }),
    /unknown system permission/,
  )
})

test('generated permission plist passes macOS validation', { skip: process.platform !== 'darwin' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-permission-plist-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'Info.plist')
  const config = defineConfig({
    ...base,
    systemPermissions: {
      macOS: {
        camera: { usageDescription: 'Use the camera <only when requested>.' },
        microphone: { usageDescription: 'Use the microphone & nothing else.' },
        location: { usageDescription: 'Find places nearby.', mode: 'always' },
      },
    },
  })
  await writeFile(path, infoPlist(config, config.productName, false))

  const linted = spawnSync('plutil', ['-lint', path], { encoding: 'utf8' })
  assert.equal(linted.status, 0, linted.stderr || linted.stdout)

  const camera = spawnSync('plutil', ['-extract', 'NSCameraUsageDescription', 'raw', path], {
    encoding: 'utf8',
  })
  assert.equal(camera.status, 0, camera.stderr || camera.stdout)
  assert.equal(camera.stdout.trim(), 'Use the camera <only when requested>.')

  const locationAlways = spawnSync(
    'plutil',
    ['-extract', 'NSLocationAlwaysAndWhenInUseUsageDescription', 'raw', path],
    { encoding: 'utf8' },
  )
  assert.equal(locationAlways.status, 0, locationAlways.stderr || locationAlways.stdout)
  assert.equal(locationAlways.stdout.trim(), 'Find places nearby.')
})
