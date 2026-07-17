import assert from 'node:assert/strict'
import test from 'node:test'

import { defineMurasakiPlugin } from '../dist/index.js'
import { metaJson } from '../dist/cli/bundle.js'
import { preparePlugins, runPluginHooks } from '../dist/plugin-runtime.js'
import { murasaki } from '../dist/vite-plugin/index.js'

function config(plugins = []) {
  return {
    appId: 'dev.test.plugins',
    productName: 'Plugin test',
    bundle: {
      external: ['base-runtime', 'shared'],
      noExternal: ['base-bundled'],
      resources: ['base.txt'],
    },
    plugins,
  }
}

test('defineMurasakiPlugin is an identity helper and duplicate stable names fail', () => {
  const plugin = { name: 'acme.assets' }
  assert.equal(defineMurasakiPlugin(plugin), plugin)
  assert.throws(
    () => preparePlugins(config([{ name: 'acme.assets' }, { name: 'acme.assets' }])),
    /duplicate plugin name "acme\.assets"/,
  )
  assert.throws(
    () => preparePlugins(config([{ name: 'Unstable Name' }])),
    /stable lowercase identifier/,
  )
  assert.throws(
    () => preparePlugins(config([{ name: 'acme.hooks', hooks: { before: true } }])),
    /hooks\.before must be a function/,
  )
  assert.throws(
    () => preparePlugins(config([{ name: 'acme.bundle', bundle: { resources: [''] } }])),
    /bundle\.resources\[0\] must not be empty/,
  )
  assert.throws(
    () => preparePlugins(config([{ name: 'acme.vite', vite: 'not-a-plugin' }])),
    /vite must be a Vite PluginOption/,
  )
})

test('bundle and Vite contributions merge deterministically in declaration order', () => {
  const firstVite = { name: 'vite:first' }
  const secondVite = { name: 'vite:second' }
  const input = config([
    {
      name: 'acme.first',
      vite: firstVite,
      bundle: {
        external: ['first-runtime', 'shared'],
        noExternal: ['first-bundled'],
        resources: ['first.txt', { from: 'assets', to: 'plugin-assets' }],
      },
    },
    {
      name: 'acme.second',
      vite: [false, secondVite],
      bundle: {
        external: ['second-runtime'],
        noExternal: ['shared'],
        resources: ['first.txt', 'second.txt'],
      },
    },
  ])
  const prepared = preparePlugins(input)

  assert.deepEqual(prepared.config.bundle, {
    external: ['base-runtime', 'first-runtime', 'second-runtime'],
    noExternal: ['base-bundled', 'first-bundled', 'shared'],
    resources: [
      'base.txt',
      'first.txt',
      { from: 'assets', to: 'plugin-assets' },
      'second.txt',
    ],
  })
  assert.deepEqual(prepared.vite, [firstVite, secondVite])
  assert.deepEqual(input.bundle.external, ['base-runtime', 'shared'])

  const vitePlugins = murasaki({ config: input, srcDir: process.cwd() }).flat()
  assert.deepEqual(vitePlugins.slice(-2).map((plugin) => plugin.name), [
    'vite:first',
    'vite:second',
  ])
})

test('hooks run serially with a frozen context and failures name the plugin', async () => {
  const calls = []
  const prepared = preparePlugins(config([
    {
      name: 'acme.first',
      hooks: {
        async before(context) {
          await Promise.resolve()
          calls.push(`first:${context.command}:${context.target}`)
          assert.equal(Object.isFrozen(context), true)
          assert.equal(Object.isFrozen(context.config), true)
          assert.equal(Object.isFrozen(context.config.bundle.resources), true)
          assert.equal('plugins' in context.config, false)
        },
      },
    },
    {
      name: 'acme.failing',
      hooks: {
        before() {
          calls.push('failing')
          throw new Error('boom')
        },
      },
    },
    {
      name: 'acme.never',
      hooks: { before() { calls.push('never') } },
    },
  ]))

  await assert.rejects(
    runPluginHooks(prepared, 'before', {
      projectRoot: process.cwd(),
      command: 'bundle',
      target: 'darwin-arm64',
    }),
    /plugin "acme\.failing" before hook failed: boom/,
  )
  assert.deepEqual(calls, ['first:bundle:darwin-arm64', 'failing'])
})

test('plugin declarations and hook functions are not serialized into native metadata', () => {
  const plugin = defineMurasakiPlugin({
    name: 'acme.metadata',
    hooks: { before() {} },
  })
  const json = metaJson(config([plugin]), 'Plugin test', null, process.cwd())
  assert.equal(json.includes('acme.metadata'), false)
  assert.equal(json.includes('hooks'), false)
})
