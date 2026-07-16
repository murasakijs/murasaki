import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadUserConfig } from '../dist/cli/load-config.js'
import { murasaki } from '../dist/vite-plugin/index.js'

async function configProject(t, source) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'murasaki.config.mjs'), source)
  return root
}

test('shared CLI loader accepts a raw default export and validates it', async (t) => {
  const root = await configProject(t, `export default {
    appId: 'dev.test.raw',
    productName: 'Raw config',
    capabilities: ['clipboard:readText']
  }\n`)
  const config = await loadUserConfig(root)
  assert.equal(config.productName, 'Raw config')
})

test('shared CLI loader rejects invalid raw exports without defineConfig()', async (t) => {
  const root = await configProject(t, `export default {
    appId: 'dev.test.invalid',
    productName: 'Invalid config',
    windows: { settings: { capabilities: ['future:permission'] } }
  }\n`)
  await assert.rejects(
    () => loadUserConfig(root),
    /windows\.settings\.capabilities contains unknown native capability/,
  )
})

test('shared CLI loader rejects invalid raw main shapes and entries', async (t) => {
  for (const [main, message] of [
    ['null', /main must be false or a main process configuration object/],
    ["'disabled'", /main must be false or a main process configuration object/],
    ['123', /main must be false or a main process configuration object/],
    ['[]', /main must be false or a main process configuration object/],
    ["{ entry: '' }", /main\.entry must be a non-empty string/],
    ['{ entry: 42 }', /main\.entry must be a non-empty string/],
  ]) {
    const root = await configProject(t, `export default {
      appId: 'dev.test.invalid-main',
      productName: 'Invalid main',
      main: ${main}
    }\n`)
    await assert.rejects(() => loadUserConfig(root), message)
  }
})

test('public Vite plugin validates raw configuration at its API boundary', () => {
  assert.throws(
    () => murasaki({
      config: { appId: 'dev.test.plugin', productName: 'Plugin', main: null },
      srcDir: process.cwd(),
    }),
    /main must be false or a main process configuration object/,
  )
})

test('public Vite plugin deduplicates React for linked and workspace packages', () => {
  const plugins = murasaki({
    config: { appId: 'dev.test.plugin', productName: 'Plugin' },
    srcDir: process.cwd(),
  }).flat()
  const core = plugins.find((plugin) => plugin?.name === 'murasaki:core')
  assert.deepEqual(core.config().resolve.dedupe, ['react', 'react-dom'])
})

test('shared config validation rejects invalid dev and updater values early', async (t) => {
  for (const [fragment, message] of [
    ['devPort: 0', /devPort must be an integer between 1 and 65535/],
    ['devPort: 65536', /devPort must be an integer between 1 and 65535/],
    ["updater: 'yes'", /updater must be a boolean or an updater configuration object/],
    ['updater: { repo: \'owner/repo\', endpoint: \'https://updates.example/latest.json\' }', /mutually exclusive/],
    ["updater: { endpoint: 'file:///tmp/latest.json' }", /absolute HTTP or HTTPS URL/],
    ["updater: { checkOnStart: 'yes' }", /checkOnStart must be a boolean/],
    ["updater: { checkInterval: '0m' }", /checkInterval must look like/],
  ]) {
    const root = await configProject(t, `export default {
      appId: 'dev.test.invalid-runtime-config',
      productName: 'Invalid runtime config',
      ${fragment}
    }\n`)
    await assert.rejects(() => loadUserConfig(root), message)
  }
})

test('shared config validation rejects artifact path traversal components', async (t) => {
  for (const [field, value] of [
    ['productName', "'../../outside'"],
    ['productName', "'C:\\\\outside'"],
    ['version', "'1.0.0/../../../outside'"],
    ['version', '42'],
  ]) {
    const root = await configProject(t, `export default {
      appId: 'dev.test.artifact-path',
      productName: ${field === 'productName' ? value : "'Safe Product'"},
      ${field === 'version' ? `version: ${value},` : ''}
    }\n`)
    await assert.rejects(
      () => loadUserConfig(root),
      new RegExp(`${field} must be`),
    )
  }
})

test('shared CLI loader surfaces missing config dependencies', async (t) => {
  const root = await configProject(t, `import 'missing-murasaki-config-dependency'\nexport default {}\n`)
  await assert.rejects(
    () => loadUserConfig(root),
    /missing-murasaki-config-dependency/,
  )
})
