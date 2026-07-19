import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadUserConfig } from '../dist/cli/load-config.js'
import { murasaki } from '../dist/vite-plugin/index.js'

async function configProject(t, source, filename = 'murasaki.config.mjs') {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(root, { recursive: true })
  await writeFile(join(root, filename), source)
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

test('shared CLI loader transpiles TypeScript config on the Node 22 floor', async (t) => {
  const root = await configProject(t, `const config: {
    appId: string
    productName: string
  } = {
    appId: 'dev.test.typescript',
    productName: 'TypeScript config'
  }
  export default config\n`, 'murasaki.config.ts')
  const config = await loadUserConfig(root)
  assert.equal(config.productName, 'TypeScript config')
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
    ["updater: { endpoint: 'http://updates.example.com/latest.json' }", /must use https/],
    ["updater: { checkOnStart: 'yes' }", /checkOnStart must be a boolean/],
    ["updater: { checkInterval: '0m' }", /checkInterval must look like/],
    ["updater: { publicKeys: ['not-a-real-key'] }", /publicKeys must be an array of 1 to 4/],
    ["updater: { publicKeys: [] }", /publicKeys must be an array of 1 to 4/],
    [
      "updater: { publicKeys: ['AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=', 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=', 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=', 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=', 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='] }",
      /publicKeys must be an array of 1 to 4/,
    ],
    ["updater: { maxManifestAgeDays: 0 }", /maxManifestAgeDays must be a positive safe integer/],
    ["updater: { maxManifestAgeDays: 12.5 }", /maxManifestAgeDays must be a positive safe integer/],
    ["build: { envPrefix: [] }", /build\.envPrefix must be a non-empty array/],
    ["build: { envPrefix: [''] }", /build\.envPrefix must be a non-empty array/],
    ["build: { envPrefix: ['PUBLIC_', 'PUBLIC_'] }", /build\.envPrefix must be a non-empty array/],
  ]) {
    const root = await configProject(t, `export default {
      appId: 'dev.test.invalid-runtime-config',
      productName: 'Invalid runtime config',
      ${fragment}
    }\n`)
    await assert.rejects(() => loadUserConfig(root), message)
  }
})

test('shared config validation allows a loopback http updater.endpoint for local testing', async (t) => {
  for (const endpoint of [
    'http://127.0.0.1:5178/latest.json',
    'http://localhost:5178/latest.json',
    'http://[::1]:5178/latest.json',
  ]) {
    const root = await configProject(t, `export default {
      appId: 'dev.test.loopback-endpoint',
      productName: 'Loopback endpoint',
      updater: { endpoint: '${endpoint}' },
    }\n`)
    const config = await loadUserConfig(root)
    assert.equal(config.updater.endpoint, endpoint)
  }
})

test('shared config validation rejects updater credentials and malformed semantic versions', async (t) => {
  for (const source of [
    `export default { appId: 'dev.test.credentials', productName: 'Credentials', updater: { endpoint: 'https://user:secret@updates.example.com/latest.json' } }`,
    `export default { appId: 'dev.test.version', productName: 'Version', version: '1.2.3garbage' }`,
    `export default { appId: 'dev.test.version', productName: 'Version', version: '1.2.3-01' }`,
    `export default { appId: 'dev.test.version', productName: 'Version', version: 'v1.2.3' }`,
  ]) {
    const root = await configProject(t, `${source}\n`)
    await assert.rejects(
      () => loadUserConfig(root),
      /embedded credentials|valid semantic version/,
    )
  }
})

test('shared config validation accepts a valid publicKeys rotation set and maxManifestAgeDays', async (t) => {
  const key1 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='
  const key2 = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI='
  const root = await configProject(t, `export default {
    appId: 'dev.test.publickeys-rotation',
    productName: 'PublicKeys rotation',
    updater: { publicKey: '${key1}', publicKeys: ['${key2}'], maxManifestAgeDays: 30 },
  }\n`)
  const config = await loadUserConfig(root)
  assert.deepEqual(config.updater.publicKeys, [key2])
  assert.equal(config.updater.maxManifestAgeDays, 30)
})

test('shared config validation rejects artifact path traversal components', async (t) => {
  for (const [field, value] of [
    ['productName', "'../../outside'"],
    ['productName', "'C:\\\\outside'"],
    ['productName', "'CON'"],
    ['productName', "'Trailing.'"],
    ['productName', "' padded '"],
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

test('shared config validation requires a portable reverse-DNS appId', async (t) => {
  for (const appId of ['single', '.com.example', 'com..example', 'com.example/app', 'com.example_unsafe']) {
    const root = await configProject(t, `export default {
      appId: ${JSON.stringify(appId)},
      productName: 'Safe Product',
    }\n`)
    await assert.rejects(() => loadUserConfig(root), /appId must be a reverse-DNS identifier/)
  }
})

test('shared CLI loader surfaces missing config dependencies', async (t) => {
  const root = await configProject(t, `import 'missing-murasaki-config-dependency'\nexport default {}\n`)
  await assert.rejects(
    () => loadUserConfig(root),
    /missing-murasaki-config-dependency/,
  )
})
