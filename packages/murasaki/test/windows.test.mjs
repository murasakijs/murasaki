import assert from 'node:assert/strict'
import test from 'node:test'

import { defineConfig, resolveWindowDeclarations } from '../dist/config.js'
import { metaJson } from '../dist/cli/bundle.js'

test('resolves a backwards-compatible primary window', () => {
  const windows = resolveWindowDeclarations({
    capabilities: ['clipboard:readText'],
    window: { width: 900 },
  })
  assert.deepEqual(windows, [{
    width: 900,
    label: 'main',
    primary: true,
    route: '/',
    visible: true,
    createOnLaunch: true,
    capabilities: ['clipboard:readText'],
  }])
})

test('always creates the primary window on launch', () => {
  const windows = resolveWindowDeclarations({
    window: { createOnLaunch: false },
  })
  assert.equal(windows[0].createOnLaunch, true)
})

test('grants the built-in updater graceful quit only to the primary window', () => {
  const windows = resolveWindowDeclarations({
    updater: true,
    windows: { updater: { route: '/updater' } },
  })
  assert.deepEqual(windows[0].capabilities, ['app:quit'])
  assert.deepEqual(windows[1].capabilities, [])
})

test('resolves primary overrides and deny-all hidden secondary windows', () => {
  const windows = resolveWindowDeclarations({
    capabilities: ['clipboard:readText'],
    window: {
      route: '/inbox?filter=unread',
      capabilities: ['window:list'],
    },
    windows: {
      settings: { route: '/settings', title: 'Settings' },
      palette: {
        route: '/palette#commands',
        visible: true,
        capabilities: ['window:manage'],
      },
    },
  })
  assert.deepEqual(windows, [
    {
      route: '/inbox?filter=unread',
      capabilities: ['window:list'],
      label: 'main',
      primary: true,
      visible: true,
      createOnLaunch: true,
    },
    {
      route: '/settings',
      title: 'Settings',
      label: 'settings',
      primary: false,
      visible: false,
      createOnLaunch: true,
      capabilities: [],
    },
    {
      route: '/palette#commands',
      visible: true,
      capabilities: ['window:manage'],
      label: 'palette',
      primary: false,
      createOnLaunch: true,
    },
  ])
})

test('validates and de-duplicates every configured capability list', () => {
  const resolved = resolveWindowDeclarations({
    capabilities: ['clipboard:readText', 'clipboard:readText'],
    windows: {
      settings: {
        capabilities: ['window:getLabel', 'window:getLabel'],
      },
    },
  })
  assert.deepEqual(resolved[0].capabilities, ['clipboard:readText'])
  assert.deepEqual(resolved[1].capabilities, ['window:getLabel'])

  const secure = resolveWindowDeclarations({
    capabilities: ['secureStorage:get', 'secureStorage:set', 'secureStorage:delete'],
  })
  assert.deepEqual(secure[0].capabilities, [
    'secureStorage:get',
    'secureStorage:set',
    'secureStorage:delete',
  ])

  const shortcuts = resolveWindowDeclarations({
    capabilities: ['globalShortcut:register', 'globalShortcut:unregister'],
  })
  assert.deepEqual(shortcuts[0].capabilities, [
    'globalShortcut:register',
    'globalShortcut:unregister',
  ])

  for (const config of [
    { capabilities: null },
    { capabilities: 'clipboard:readText' },
    { capabilities: ['future:permission'] },
    { capabilities: ['clipboard:readText'], window: { capabilities: null } },
    { windows: { settings: { capabilities: null } } },
    { capabilities: ['future:permission'], window: { capabilities: [] } },
  ]) {
    assert.throws(
      () => resolveWindowDeclarations(config),
      /capabilities.*array|unknown native capability/,
    )
  }
})

test('validates structured native capability scopes and preserves them in metadata', () => {
  const capabilities = [
    {
      permission: 'shell:openExternal',
      allow: { urls: ['https://docs.example.com/**'] },
      deny: { urls: ['https://docs.example.com/private/**'] },
    },
    {
      permission: 'shell:showItemInFolder',
      allow: { paths: ['/tmp/murasaki/**'] },
    },
    {
      permission: 'shell:trashItem',
      allow: { paths: ['/tmp/murasaki/**'] },
    },
    {
      permission: 'shell:openPath',
      allow: { paths: ['/tmp/murasaki/**'] },
    },
    {
      permission: 'window:manage',
      allow: { windows: ['settings'] },
    },
    {
      permission: 'systemPermission:request',
      allow: { permissions: ['camera'] },
    },
  ]
  const resolved = resolveWindowDeclarations({ capabilities })
  assert.deepEqual(resolved[0].capabilities, capabilities)

  const config = {
    appId: 'dev.test.scopes',
    productName: 'Scoped Test',
    capabilities,
  }
  const meta = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(meta.capabilities, capabilities.map((grant) => grant.permission))
  assert.deepEqual(
    JSON.parse(meta.windows[0].capabilityPolicy),
    { version: 1, grants: capabilities },
  )
})

test('rejects ambiguous or unsafe structured capability scopes', () => {
  for (const capabilities of [
    [{ permission: 'clipboard:readText', allow: { urls: ['https://example.com/**'] } }],
    [{ permission: 'shell:openExternal' }],
    [{ permission: 'shell:openExternal', allow: {} }],
    [{ permission: 'shell:openExternal', allow: { urls: ['https://example.com/*'] } }],
    [{ permission: 'shell:openExternal', allow: { urls: ['https://example.com/foo*/**'] } }],
    [{ permission: 'shell:openExternal', allow: { urls: ['https://example.com/path?next=/**'] } }],
    [{ permission: 'shell:openExternal', allow: { urls: ['https://user@example.com/**'] } }],
    [{ permission: 'shell:showItemInFolder', allow: { paths: ['relative/**'] } }],
    [{ permission: 'shell:showItemInFolder', allow: { paths: ['/tmp/../secret/**'] } }],
    [{ permission: 'shell:showItemInFolder', allow: { paths: ['/tmp/*/secret/**'] } }],
    [{ permission: 'shell:trashItem', allow: { paths: ['relative/**'] } }],
    [{ permission: 'shell:openPath', allow: { urls: ['https://example.com/**'] } }],
    [{ permission: 'window:manage', allow: { windows: ['bad label'] } }],
    [{ permission: 'systemPermission:request', allow: { permissions: ['bogusPermission'] } }],
    [{ permission: 'secureStorage:get', allow: { paths: ['/tmp/**'] } }],
    ['window:manage', { permission: 'window:manage', allow: { windows: ['settings'] } }],
  ]) {
    assert.throws(
      () => resolveWindowDeclarations({ capabilities }),
      /not valid|must define|must not be empty|trailing \/\*\*|cannot contain a query|credential-free|absolute path|invalid window label|unknown system permission|more than one grant/,
    )
  }
})

test('preserves one-axis minimum sizes by leaving the other axis unconstrained', () => {
  const resolved = resolveWindowDeclarations({
    window: { minWidth: 480 },
    windows: { palette: { minHeight: 320 } },
  })
  assert.deepEqual(
    { minWidth: resolved[0].minWidth, minHeight: resolved[0].minHeight },
    { minWidth: 480, minHeight: 0 },
  )
  assert.deepEqual(
    { minWidth: resolved[1].minWidth, minHeight: resolved[1].minHeight },
    { minWidth: 0, minHeight: 320 },
  )
  const config = {
    appId: 'dev.test.minimum',
    productName: 'Minimum size',
    window: { minWidth: 480 },
  }
  const meta = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(
    { minWidth: meta.windows[0].minWidth, minHeight: meta.windows[0].minHeight },
    { minWidth: 480, minHeight: 0 },
  )
  for (const minWidth of [-1, 0]) {
    assert.throws(
      () => resolveWindowDeclarations({ window: { minWidth } }),
      /minWidth.*positive/,
    )
  }
})

test('resolves maximum sizes and validates the max >= min rule', () => {
  const resolved = resolveWindowDeclarations({
    window: { maxWidth: 1600 },
    windows: { palette: { maxHeight: 900 } },
  })
  assert.deepEqual(
    { maxWidth: resolved[0].maxWidth, maxHeight: resolved[0].maxHeight },
    { maxWidth: 1600, maxHeight: 2_147_483_647 },
  )
  assert.deepEqual(
    { maxWidth: resolved[1].maxWidth, maxHeight: resolved[1].maxHeight },
    { maxWidth: 2_147_483_647, maxHeight: 900 },
  )

  const config = {
    appId: 'dev.test.maximum',
    productName: 'Maximum size',
    window: { maxWidth: 1600 },
  }
  const meta = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(
    { maxWidth: meta.windows[0].maxWidth, maxHeight: meta.windows[0].maxHeight },
    { maxWidth: 1600, maxHeight: 2_147_483_647 },
  )

  for (const maxWidth of [-1, 0, 1.5]) {
    assert.throws(
      () => resolveWindowDeclarations({ window: { maxWidth } }),
      /maxWidth.*positive/,
    )
  }

  assert.throws(
    () => resolveWindowDeclarations({ window: { minWidth: 800, maxWidth: 600 } }),
    /maxWidth.*greater than or equal to minWidth/,
  )
  assert.throws(
    () => resolveWindowDeclarations({ window: { minHeight: 800, maxHeight: 600 } }),
    /maxHeight.*greater than or equal to minHeight/,
  )
  // Equal bounds are allowed.
  const equalBounds = resolveWindowDeclarations({
    window: { minWidth: 800, maxWidth: 800, minHeight: 600, maxHeight: 600 },
  })
  assert.deepEqual(
    { maxWidth: equalBounds[0].maxWidth, maxHeight: equalBounds[0].maxHeight },
    { maxWidth: 800, maxHeight: 600 },
  )
})

test('validates decorations/fullscreen/titleBarStyle and warns only for macOS-only titleBarStyle', () => {
  for (const window of [
    { decorations: 'no' },
    { fullscreen: 'yes' },
    { titleBarStyle: 'floating' },
  ]) {
    assert.throws(
      () => resolveWindowDeclarations({ window }),
      /decorations|fullscreen|titleBarStyle/,
    )
  }

  const resolved = resolveWindowDeclarations({
    window: { decorations: false, fullscreen: true, titleBarStyle: 'default' },
  })
  assert.deepEqual(
    {
      decorations: resolved[0].decorations,
      fullscreen: resolved[0].fullscreen,
      titleBarStyle: resolved[0].titleBarStyle,
    },
    { decorations: false, fullscreen: true, titleBarStyle: 'default' },
  )

  const originalWarn = console.warn
  const warnings = []
  console.warn = (message) => warnings.push(message)
  try {
    resolveWindowDeclarations({ window: { titleBarStyle: 'default' } })
    assert.equal(warnings.length, 0)
    resolveWindowDeclarations({ window: { titleBarStyle: 'hidden' } })
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /window main titleBarStyle.*macOS only/)
})

test('passes frameless/titlebar/max-size/fullscreen fields through dev and bundle metadata', async () => {
  const config = {
    appId: 'dev.test.frameless',
    productName: 'Frameless',
    window: {
      decorations: false,
      titleBarStyle: 'hidden',
      maxWidth: 1600,
      maxHeight: 1200,
      fullscreen: true,
    },
  }
  const expected = {
    decorations: false,
    titleBarStyle: 'hidden',
    maxWidth: 1600,
    maxHeight: 1200,
    fullscreen: true,
  }

  const originalWarn = console.warn
  console.warn = () => {}
  let devTemplate
  let meta
  try {
    const { createDevWindowTemplates } = await import('../dist/cli/dev.js')
    ;[devTemplate] = createDevWindowTemplates(config, process.cwd(), 'http://127.0.0.1:5178/')
    meta = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  } finally {
    console.warn = originalWarn
  }

  assert.deepEqual(
    {
      decorations: devTemplate.window.decorations,
      titleBarStyle: devTemplate.window.titleBarStyle,
      maxWidth: devTemplate.window.maxWidth,
      maxHeight: devTemplate.window.maxHeight,
      fullscreen: devTemplate.window.fullscreen,
    },
    expected,
  )
  assert.deepEqual(
    {
      decorations: meta.decorations,
      titleBarStyle: meta.titleBarStyle,
      maxWidth: meta.maxWidth,
      maxHeight: meta.maxHeight,
      fullscreen: meta.fullscreen,
    },
    expected,
  )
  assert.deepEqual(
    {
      decorations: meta.windows[0].decorations,
      titleBarStyle: meta.windows[0].titleBarStyle,
      maxWidth: meta.windows[0].maxWidth,
      maxHeight: meta.windows[0].maxHeight,
      fullscreen: meta.windows[0].fullscreen,
    },
    expected,
  )
})

test('rejects invalid raw window fields before they reach the native binding', () => {
  for (const window of [
    { width: 0 },
    { width: 1.5 },
    { height: -1 },
    { title: 42 },
    { resizable: 'yes' },
    { transparent: 1 },
    { visible: null },
    { console: 'false' },
    { vibrancy: 'glass' },
  ]) {
    assert.throws(
      () => resolveWindowDeclarations({ window }),
      /window main (?:width|height|title|resizable|transparent|visible|console|vibrancy)/,
    )
  }

  for (const createOnLaunch of [null, 'false', 0]) {
    assert.throws(
      () => resolveWindowDeclarations({ windows: { settings: { createOnLaunch } } }),
      /window settings createOnLaunch must be a boolean/,
    )
  }
})

test('keeps dormant declarations in dev and bundle metadata', async () => {
  const config = {
    appId: 'dev.test.dynamic-windows',
    productName: 'Dynamic Windows',
    window: { route: '/main' },
    windows: {
      settings: { route: '/settings', createOnLaunch: false },
      preview: { route: '/preview' },
    },
  }
  const resolved = resolveWindowDeclarations(config)
  assert.deepEqual(
    resolved.map(({ label, createOnLaunch }) => ({ label, createOnLaunch })),
    [
      { label: 'main', createOnLaunch: true },
      { label: 'settings', createOnLaunch: false },
      { label: 'preview', createOnLaunch: true },
    ],
  )

  const { createDevWindowTemplates } = await import('../dist/cli/dev.js')
  const devTemplates = createDevWindowTemplates(config, process.cwd(), 'http://127.0.0.1:5178/')
  assert.deepEqual(
    devTemplates.map(({ window, createOnLaunch }) => ({ label: window.label, createOnLaunch })),
    [
      { label: 'main', createOnLaunch: true },
      { label: 'settings', createOnLaunch: false },
      { label: 'preview', createOnLaunch: true },
    ],
  )

  const meta = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(
    meta.windows.map(({ label, createOnLaunch }) => ({ label, createOnLaunch })),
    [
      { label: 'main', createOnLaunch: true },
      { label: 'settings', createOnLaunch: false },
      { label: 'preview', createOnLaunch: true },
    ],
  )
})

test('rejects reserved or unsafe labels and non-local routes', () => {
  assert.throws(
    () => defineConfig({ appId: 'dev.test', productName: 'Test', windows: { main: {} } }),
    /reserved/,
  )
  assert.throws(
    () => resolveWindowDeclarations({ windows: { 'bad label': {} } }),
    /window label/,
  )
  assert.throws(
    () => resolveWindowDeclarations({ windows: { ["a".repeat(65)]: {} } }),
    /1-64/,
  )
  assert.throws(
    () => resolveWindowDeclarations({ windows: { settings: { console: true } } }),
    /console is not supported/,
  )
  for (const route of ['https://example.com/', '//example.com/', 'settings', '/\\example.com/']) {
    assert.throws(
      () => resolveWindowDeclarations({ windows: { settings: { route } } }),
      /same-origin|application origin/,
    )
  }
})

test('validates the main shutdown timeout before dev or bundle startup', () => {
  for (const shutdownTimeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 300_001]) {
    const config = {
      appId: 'dev.test.timeout',
      productName: 'Timeout Test',
      main: { shutdownTimeoutMs },
    }
    assert.throws(() => defineConfig(config), /main\.shutdownTimeoutMs/)
    assert.throws(
      () => metaJson(config, config.productName, null, process.cwd()),
      /main\.shutdownTimeoutMs/,
    )
  }

  const valid = {
    appId: 'dev.test.timeout',
    productName: 'Timeout Test',
    main: { shutdownTimeoutMs: 20_000 },
  }
  assert.equal(
    JSON.parse(metaJson(valid, valid.productName, null, process.cwd())).mainShutdownTimeoutMs,
    20_000,
  )
})

test('bundle metadata contains resolved windows and keeps primary flat fields', () => {
  const config = {
    appId: 'dev.test.windows',
    productName: 'Windows Test',
    version: '1.2.3',
    capabilities: ['clipboard:readText'],
    window: { width: 1024, route: '/home' },
    windows: {
      settings: { route: '/settings', height: 640 },
    },
  }
  const meta = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.equal(meta.width, 1024)
  assert.deepEqual(meta.capabilities, ['clipboard:readText'])
  assert.deepEqual(
    JSON.parse(meta.capabilityPolicy),
    { version: 1, grants: ['clipboard:readText'] },
  )
  assert.deepEqual(meta.windows, [
    {
      label: 'main',
      primary: true,
      route: '/home',
      visible: true,
      createOnLaunch: true,
      width: 1024,
      capabilities: ['clipboard:readText'],
      capabilityPolicy: JSON.stringify({ version: 1, grants: ['clipboard:readText'] }),
    },
    {
      label: 'settings',
      primary: false,
      route: '/settings',
      visible: false,
      createOnLaunch: true,
      height: 640,
      capabilities: [],
      capabilityPolicy: JSON.stringify({ version: 1, grants: [] }),
    },
  ])
})
