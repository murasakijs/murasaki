import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  defineConfig,
  resolveStartupSystemPermissions,
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
      },
    },
  })

  assert.deepEqual(resolveStartupSystemPermissions(config), [
    'camera',
    'screenRecording',
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

  const meta = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(meta.systemPermissionsOnLaunch, ['camera', 'screenRecording'])
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
})
