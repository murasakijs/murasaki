import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build, resolveConfig } from 'vite'

import {
  DEFAULT_RENDERER_ENV_PREFIX,
  loadProjectEnv,
} from '../dist/cli/load-env.js'
import { loadUserConfig } from '../dist/cli/load-config.js'
import { murasaki } from '../dist/vite-plugin/index.js'

const KEYS = [
  'MURASAKI_ENV_LAYER_TEST',
  'MURASAKI_ENV_EXPANDED_TEST',
  'MURASAKI_ENV_OS_TEST',
  'MURASAKI_CONFIG_ENV_TEST',
  'MURASAKI_PUBLIC_RENDERER_TEST',
  'NEXT_PUBLIC_LEGACY_TEST',
]

async function project(t) {
  // Vite/Rollup resolves macOS' /var symlink to /private/var. Return the real
  // path so HTML entry names remain inside root during production builds.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'murasaki-env-')))
  await mkdir(join(root, 'src'), { recursive: true })
  t.after(async () => {
    for (const key of KEYS) delete process.env[key]
    await rm(root, { recursive: true, force: true })
  })
  return root
}

test('project env files load in mode order and preserve terminal values', async (t) => {
  const root = await project(t)
  await writeFile(join(root, '.env'), [
    'MURASAKI_ENV_LAYER_TEST=base',
    'MURASAKI_ENV_EXPANDED_TEST=${MURASAKI_ENV_LAYER_TEST}-expanded',
    'MURASAKI_ENV_OS_TEST=file',
    '',
  ].join('\n'))
  await writeFile(join(root, '.env.local'), 'MURASAKI_ENV_LAYER_TEST=local\n')
  await writeFile(join(root, '.env.development'), 'MURASAKI_ENV_LAYER_TEST=development\n')
  await writeFile(
    join(root, '.env.development.local'),
    'MURASAKI_ENV_LAYER_TEST=development-local\n',
  )
  process.env.MURASAKI_ENV_OS_TEST = 'terminal'

  const loaded = loadProjectEnv(root, 'development')

  assert.equal(loaded.MURASAKI_ENV_LAYER_TEST, 'development-local')
  assert.equal(process.env.MURASAKI_ENV_LAYER_TEST, 'development-local')
  assert.equal(process.env.MURASAKI_ENV_EXPANDED_TEST, 'development-local-expanded')
  assert.equal(process.env.MURASAKI_ENV_OS_TEST, 'terminal')
})

test('env is available while evaluating murasaki.config', async (t) => {
  const root = await project(t)
  await writeFile(join(root, '.env.production'), 'MURASAKI_CONFIG_ENV_TEST=Configured\n')
  await writeFile(join(root, 'murasaki.config.mjs'), `export default {
    appId: 'dev.test.environment',
    productName: process.env.MURASAKI_CONFIG_ENV_TEST,
  }\n`)

  const config = await loadUserConfig(root)
  assert.equal(config.productName, 'Configured')
})

test('renderer exposes only the Murasaki public prefix by default', async (t) => {
  const root = await project(t)
  await writeFile(join(root, '.env.production'), [
    'MURASAKI_PUBLIC_RENDERER_TEST=visible',
    'NEXT_PUBLIC_LEGACY_TEST=hidden',
    '',
  ].join('\n'))
  const plugins = murasaki({
    config: { appId: 'dev.test.environment', productName: 'Environment' },
    srcDir: join(root, 'src'),
  })
  const resolved = await resolveConfig(
    { root, configFile: false, plugins },
    'build',
    'production',
  )

  assert.deepEqual(DEFAULT_RENDERER_ENV_PREFIX, ['MURASAKI_PUBLIC_'])
  assert.deepEqual(resolved.envPrefix, ['MURASAKI_PUBLIC_'])
  assert.equal(resolved.env.MURASAKI_PUBLIC_RENDERER_TEST, 'visible')
  assert.equal(resolved.env.NEXT_PUBLIC_LEGACY_TEST, undefined)
})

test('production renderer bundle embeds public values without leaking private env', async (t) => {
  const root = await project(t)
  await writeFile(join(root, '.env.production'), [
    'MURASAKI_PUBLIC_RENDERER_TEST=public-value-7f69',
    'MURASAKI_ENV_OS_TEST=private-value-2c84',
    '',
  ].join('\n'))
  await writeFile(
    join(root, 'index.html'),
    '<script type="module" src="/src.js"></script>\n',
  )
  await writeFile(join(root, 'src.js'), `document.body.textContent = [
    import.meta.env.MURASAKI_PUBLIC_RENDERER_TEST,
    import.meta.env.MURASAKI_ENV_OS_TEST,
  ].join(':')\n`)

  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    envPrefix: [...DEFAULT_RENDERER_ENV_PREFIX],
  })
  const html = await readFile(join(root, 'dist/index.html'), 'utf8')
  const asset = html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(asset)
  const output = await readFile(join(root, 'dist', asset.replace(/^\//, '')), 'utf8')
  assert.match(output, /public-value-7f69/)
  assert.doesNotMatch(output, /private-value-2c84/)
})

test('build.envPrefix can opt into additional renderer prefixes', () => {
  const plugins = murasaki({
    config: {
      appId: 'dev.test.environment',
      productName: 'Environment',
      build: { envPrefix: ['ACME_PUBLIC_'] },
    },
    srcDir: join(process.cwd(), 'src'),
  }).flat()
  const core = plugins.find((plugin) => plugin?.name === 'murasaki:core')
  assert.deepEqual(core.config().envPrefix, ['ACME_PUBLIC_'])
})
