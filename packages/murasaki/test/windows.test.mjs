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
    capabilities: ['clipboard:readText'],
  }])
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
    },
    {
      route: '/settings',
      title: 'Settings',
      label: 'settings',
      primary: false,
      visible: false,
      capabilities: [],
    },
    {
      route: '/palette#commands',
      visible: true,
      capabilities: ['window:manage'],
      label: 'palette',
      primary: false,
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
  assert.deepEqual(meta.windows, [
    {
      label: 'main',
      primary: true,
      route: '/home',
      visible: true,
      width: 1024,
      capabilities: ['clipboard:readText'],
    },
    {
      label: 'settings',
      primary: false,
      route: '/settings',
      visible: false,
      height: 640,
      capabilities: [],
    },
  ])
})
