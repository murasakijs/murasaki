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
import {
  entitlementsPlist,
  helperEntitlementsPlist,
  infoPlist,
  metaJson,
} from '../dist/cli/bundle.js'

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

test('new capture-style kinds require a usageDescription and resolve launch requests', () => {
  const config = defineConfig({
    ...base,
    systemPermissions: {
      macOS: {
        photos: { usageDescription: 'Pick a photo.', requestOnLaunch: true },
        contacts: { usageDescription: 'Find your friends.' },
        calendar: { usageDescription: 'See your schedule.', requestOnLaunch: true },
        reminders: { usageDescription: 'See your reminders.' },
        speechRecognition: { usageDescription: 'Transcribe speech.', requestOnLaunch: true },
        bluetooth: { usageDescription: 'Find nearby devices.' },
      },
    },
  })

  assert.deepEqual(resolveStartupSystemPermissions(config), [
    'photos',
    'calendar',
    'speechRecognition',
  ])

  const plist = infoPlist(config, config.productName, false)
  assert.match(plist, /<key>NSPhotoLibraryUsageDescription<\/key><string>Pick a photo\.<\/string>/)
  assert.match(plist, /<key>NSContactsUsageDescription<\/key><string>Find your friends\.<\/string>/)
  assert.match(plist, /<key>NSSpeechRecognitionUsageDescription<\/key><string>Transcribe speech\.<\/string>/)
  assert.match(plist, /<key>NSBluetoothAlwaysUsageDescription<\/key><string>Find nearby devices\.<\/string>/)
  // calendar/reminders always write both the legacy and macOS 14+ full-access
  // keys — see infoPlist's comment for why this isn't mode-gated.
  assert.match(plist, /<key>NSCalendarsUsageDescription<\/key><string>See your schedule\.<\/string>/)
  assert.match(plist, /<key>NSCalendarsFullAccessUsageDescription<\/key><string>See your schedule\.<\/string>/)
  assert.match(plist, /<key>NSRemindersUsageDescription<\/key><string>See your reminders\.<\/string>/)
  assert.match(plist, /<key>NSRemindersFullAccessUsageDescription<\/key><string>See your reminders\.<\/string>/)

  for (const name of ['photos', 'contacts', 'calendar', 'reminders', 'speechRecognition', 'bluetooth']) {
    assert.throws(
      () => defineConfig({
        ...base,
        systemPermissions: { macOS: { [name]: { requestOnLaunch: true } } },
      }),
      new RegExp(`${name}\\.usageDescription`),
    )
  }
})

test('declaration-only kinds (appleEvents, localNetwork) require a usageDescription and have no requestOnLaunch', () => {
  const config = defineConfig({
    ...base,
    systemPermissions: {
      macOS: {
        appleEvents: { usageDescription: 'Automate another app.' },
        localNetwork: { usageDescription: 'Discover devices on this network.' },
      },
    },
  })

  // Never surfaced as launch-time requests — see resolveStartupSystemPermissions's doc comment.
  assert.deepEqual(resolveStartupSystemPermissions(config), [])

  const plist = infoPlist(config, config.productName, false)
  assert.match(plist, /<key>NSAppleEventsUsageDescription<\/key><string>Automate another app\.<\/string>/)
  assert.match(
    plist,
    /<key>NSLocalNetworkUsageDescription<\/key><string>Discover devices on this network\.<\/string>/,
  )

  for (const name of ['appleEvents', 'localNetwork']) {
    assert.throws(
      () => defineConfig({ ...base, systemPermissions: { macOS: { [name]: {} } } }),
      new RegExp(`${name}\\.usageDescription`),
    )
  }
})

test('systemPermission capability scope accepts every new kind', () => {
  const capabilities = [
    {
      permission: 'systemPermission:request',
      allow: {
        permissions: [
          'photos',
          'contacts',
          'calendar',
          'reminders',
          'speechRecognition',
          'bluetooth',
          'appleEvents',
          'localNetwork',
        ],
      },
    },
  ]
  const resolved = resolveWindowDeclarations({ capabilities })
  assert.deepEqual(resolved[0].capabilities, capabilities)
})

test('main entitlements: hardened runtime adds declared host resource rights, never Node JIT or App Sandbox', () => {
  const noPermissions = defineConfig(base)
  const plainPlist = entitlementsPlist(noPermissions)
  assert.doesNotMatch(plainPlist, /com\.apple\.security\.cs\./)
  assert.doesNotMatch(plainPlist, /com\.apple\.security\.automation\.apple-events/)
  assert.doesNotMatch(plainPlist, /com\.apple\.security\.app-sandbox/)

  const withProtectedResources = defineConfig({
    ...base,
    systemPermissions: {
      macOS: {
        camera: { usageDescription: 'Use the camera.' },
        microphone: { usageDescription: 'Use the microphone.' },
        location: { usageDescription: 'Use your location.' },
        photos: { usageDescription: 'Use your photos.' },
        contacts: { usageDescription: 'Use your contacts.' },
        calendar: { usageDescription: 'Use your calendar.' },
        reminders: { usageDescription: 'Use your reminders.' },
        speechRecognition: { usageDescription: 'Transcribe speech.' },
        bluetooth: { usageDescription: 'Use Bluetooth.' },
        appleEvents: { usageDescription: 'Automate another app.' },
      },
    },
  })
  const plist = entitlementsPlist(withProtectedResources)
  for (const entitlement of [
    'com.apple.security.device.camera',
    'com.apple.security.device.audio-input',
    'com.apple.security.personal-information.location',
    'com.apple.security.personal-information.photos-library',
    'com.apple.security.personal-information.addressbook',
    'com.apple.security.personal-information.calendars',
    'com.apple.security.automation.apple-events',
  ]) {
    assert.match(plist, new RegExp(`<key>${entitlement.replaceAll('.', '\\\.') }<\\/key><true\\/>`))
  }
  assert.equal((plist.match(/com\.apple\.security\.personal-information\.calendars/g) ?? []).length, 1)
  assert.doesNotMatch(plist, /com\.apple\.security\.device\.bluetooth/)
  assert.doesNotMatch(plist, /speech/)
  assert.doesNotMatch(plist, /com\.apple\.security\.cs\./)
  assert.doesNotMatch(plist, /com\.apple\.security\.app-sandbox/)
})

test('App Sandbox is rejected until the bundled Node helper has a valid sandbox architecture', () => {
  assert.throws(
    () => defineConfig({ ...base, sign: { appSandbox: true } }),
    /appSandbox is not supported by the current bundled-Node architecture/,
  )
  const unvalidated = { ...base, sign: { appSandbox: true } }
  assert.throws(() => entitlementsPlist(unvalidated), /App Sandbox is unsupported/)
  assert.throws(() => helperEntitlementsPlist(unvalidated), /App Sandbox is unsupported/)
})

test('Node helper entitlements confine JIT rights without granting host or sandbox rights', () => {
  const plain = helperEntitlementsPlist(defineConfig(base))
  assert.match(plain, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(plain, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/)
  assert.match(plain, /com\.apple\.security\.cs\.disable-library-validation/)
  assert.doesNotMatch(plain, /com\.apple\.security\.app-sandbox/)
  assert.doesNotMatch(plain, /com\.apple\.security\.inherit/)
})

test('generated permission and entitlement plists pass macOS validation', { skip: process.platform !== 'darwin' }, async (t) => {
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

  const appEntitlementsPath = join(root, 'app.entitlements')
  const helperEntitlementsPath = join(root, 'node-helper.entitlements')
  await writeFile(appEntitlementsPath, entitlementsPlist(config))
  await writeFile(helperEntitlementsPath, helperEntitlementsPlist(config))

  const linted = spawnSync('plutil', ['-lint', path], { encoding: 'utf8' })
  assert.equal(linted.status, 0, linted.stderr || linted.stdout)
  for (const entitlementPath of [appEntitlementsPath, helperEntitlementsPath]) {
    const entitlementLint = spawnSync('plutil', ['-lint', entitlementPath], { encoding: 'utf8' })
    assert.equal(entitlementLint.status, 0, entitlementLint.stderr || entitlementLint.stdout)
  }

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
