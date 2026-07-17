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
import { entitlementsPlist, infoPlist, metaJson } from '../dist/cli/bundle.js'

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

test('entitlementsPlist: hardened runtime (default) only adds the automation entitlement, never sandbox-only ones', () => {
  const noPermissions = defineConfig(base)
  const plainPlist = entitlementsPlist(noPermissions)
  assert.match(plainPlist, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(plainPlist, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/)
  assert.match(plainPlist, /com\.apple\.security\.cs\.disable-library-validation/)
  assert.doesNotMatch(plainPlist, /com\.apple\.security\.automation\.apple-events/)
  assert.doesNotMatch(plainPlist, /com\.apple\.security\.app-sandbox/)

  const withCamera = defineConfig({
    ...base,
    systemPermissions: { macOS: { camera: { usageDescription: 'Use the camera.' } } },
  })
  // Camera works from just the Info.plist purpose string under hardened
  // runtime alone — no device entitlement is added outside App Sandbox.
  assert.doesNotMatch(entitlementsPlist(withCamera), /com\.apple\.security\.device\.camera/)

  const withAppleEvents = defineConfig({
    ...base,
    systemPermissions: { macOS: { appleEvents: { usageDescription: 'Automate another app.' } } },
  })
  assert.match(entitlementsPlist(withAppleEvents), /<key>com\.apple\.security\.automation\.apple-events<\/key><true\/>/)
  assert.doesNotMatch(entitlementsPlist(withAppleEvents), /com\.apple\.security\.app-sandbox/)
})

test('entitlementsPlist: sign.appSandbox adds app-sandbox plus every declared kind\'s sandbox entitlement, omitting photos', () => {
  const config = defineConfig({
    ...base,
    systemPermissions: {
      macOS: {
        camera: { usageDescription: 'Use the camera.' },
        microphone: { usageDescription: 'Use the microphone.' },
        location: { usageDescription: 'Find nearby places.' },
        contacts: { usageDescription: 'Find your friends.' },
        calendar: { usageDescription: 'See your schedule.' },
        reminders: { usageDescription: 'See your reminders.' },
        bluetooth: { usageDescription: 'Find nearby devices.' },
        photos: { usageDescription: 'Pick a photo.' },
        appleEvents: { usageDescription: 'Automate another app.' },
      },
    },
    sign: { appSandbox: true },
  })
  const plist = entitlementsPlist(config)
  assert.match(plist, /<key>com\.apple\.security\.app-sandbox<\/key><true\/>/)
  assert.match(plist, /<key>com\.apple\.security\.device\.camera<\/key><true\/>/)
  assert.match(plist, /<key>com\.apple\.security\.device\.audio-input<\/key><true\/>/)
  assert.match(plist, /<key>com\.apple\.security\.personal-information\.location<\/key><true\/>/)
  assert.match(plist, /<key>com\.apple\.security\.personal-information\.addressbook<\/key><true\/>/)
  assert.match(plist, /<key>com\.apple\.security\.device\.bluetooth<\/key><true\/>/)
  // calendar and reminders share the same sandbox key, deduplicated to one entry.
  assert.equal(
    (plist.match(/com\.apple\.security\.personal-information\.calendars/g) ?? []).length,
    1,
  )
  // The automation entitlement applies independently of sandboxing.
  assert.match(plist, /<key>com\.apple\.security\.automation\.apple-events<\/key><true\/>/)
  // Photos has no documented sandbox entitlement — deliberately omitted.
  assert.doesNotMatch(plist, /photos/i)
})

test('entitlementsPlist: appSandbox with no declared permissions only adds the bare app-sandbox key', () => {
  const config = defineConfig({ ...base, sign: { appSandbox: true } })
  const plist = entitlementsPlist(config)
  assert.match(plist, /<key>com\.apple\.security\.app-sandbox<\/key><true\/>/)
  assert.doesNotMatch(plist, /com\.apple\.security\.device/)
  assert.doesNotMatch(plist, /com\.apple\.security\.personal-information/)
  assert.doesNotMatch(plist, /com\.apple\.security\.automation/)
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
