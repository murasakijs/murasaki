import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import buildServer from '../dist/cli/build-server.js'
import {
  packageNameFromImport,
  readServerDependenciesManifest,
  stageBundleResources,
  stageServerDependencies,
} from '../dist/cli/server-dependencies.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-server-deps-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, type: 'module', dependencies: { ws: '1.0.0' } }),
  )
  await writeFile(
    join(root, 'src/main.ts'),
    `import ws from 'ws'\nexport default { ready() { return ws } }\n`,
  )

  const wsRoot = join(root, 'node_modules/ws')
  const helperRoot = join(root, 'node_modules/native-helper')
  const computedRoot = join(root, 'node_modules/computed-plugin')
  await mkdir(wsRoot, { recursive: true })
  await mkdir(join(helperRoot, 'prebuilds/darwin-arm64'), { recursive: true })
  await mkdir(computedRoot, { recursive: true })
  await writeFile(
    join(wsRoot, 'package.json'),
    JSON.stringify({
      name: 'ws',
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
      dependencies: { 'native-helper': '1.0.0' },
    }),
  )
  await writeFile(
    join(wsRoot, 'index.js'),
    `import helper from 'native-helper'\nexport default 'socket-' + helper\n`,
  )
  await writeFile(
    join(helperRoot, 'package.json'),
    JSON.stringify({ name: 'native-helper', version: '1.0.0', main: 'index.js' }),
  )
  await writeFile(join(helperRoot, 'index.js'), `module.exports = 'native'\n`)
  await writeFile(join(helperRoot, 'prebuilds/darwin-arm64/addon.node'), 'binary-placeholder')
  await writeFile(
    join(computedRoot, 'package.json'),
    JSON.stringify({ name: 'computed-plugin', version: '1.0.0', main: 'index.js' }),
  )
  await writeFile(join(computedRoot, 'index.js'), `module.exports = 'computed'\n`)

  return root
}

test('packageNameFromImport recognizes bare package subpaths only', () => {
  assert.equal(packageNameFromImport('ws'), 'ws')
  assert.equal(packageNameFromImport('ws/lib/websocket.js'), 'ws')
  assert.equal(packageNameFromImport('@scope/pkg/subpath'), '@scope/pkg')
  assert.equal(packageNameFromImport('./local.js'), null)
  assert.equal(packageNameFromImport('/absolute.js'), null)
  assert.equal(packageNameFromImport('node:fs'), null)
  assert.equal(packageNameFromImport('virtual:murasaki/wire'), null)
  assert.equal(packageNameFromImport('@/local-alias'), null)
  assert.equal(packageNameFromImport('#package-import'), null)
})

test('server build externalizes app packages and portable staging keeps package data/native files', async (t) => {
  const root = await fixture(t)
  const config = {
    appId: 'com.example.fixture',
    productName: 'Fixture',
    bundle: { external: ['computed-plugin'] },
  }
  await buildServer(root, join(root, 'src'), config)

  const main = await readFile(join(root, 'dist/server/main.mjs'), 'utf8')
  assert.match(main, /from ['"]ws['"]/)
  const manifest = await readServerDependenciesManifest(join(root, 'dist/server'))
  assert.deepEqual(manifest.dependencies, ['computed-plugin', 'ws'])

  const resources = join(root, 'staged')
  const staged = await stageServerDependencies(root, join(root, 'dist/server'), resources, config)
  assert.deepEqual(staged, ['computed-plugin', 'ws'])
})

test('staging recursively copies dependency trees and explicit resources', async (t) => {
  const root = await fixture(t)
  const server = join(root, 'server')
  const resources = join(root, 'resources')
  await mkdir(server)
  await writeFile(
    join(server, 'runtime-dependencies.json'),
    JSON.stringify({ version: 1, dependencies: ['ws'] }),
  )
  await mkdir(join(root, 'prisma/migrations'), { recursive: true })
  await writeFile(join(root, 'prisma/schema.prisma'), 'datasource db {}')
  await writeFile(join(root, 'prisma/migrations/001.sql'), 'select 1;')

  const staged = await stageServerDependencies(root, server, resources, {
    appId: 'com.example.fixture',
    productName: 'Fixture',
  })
  assert.deepEqual(staged, ['ws'])
  assert.equal(
    await readFile(
      join(resources, 'node_modules/ws/node_modules/native-helper/prebuilds/darwin-arm64/addon.node'),
      'utf8',
    ),
    'binary-placeholder',
  )
  await mkdir(join(resources, 'server'))
  const runtimeProbe = join(resources, 'server/runtime-probe.mjs')
  await writeFile(runtimeProbe, `import value from 'ws'\nexport default value\n`)
  assert.equal((await import(`${pathToFileURL(runtimeProbe)}?${Date.now()}`)).default, 'socket-native')

  const copied = await stageBundleResources(root, resources, {
    appId: 'com.example.fixture',
    productName: 'Fixture',
    bundle: { resources: [{ from: 'prisma', to: 'app-data/prisma' }] },
  })
  assert.deepEqual(copied, ['app-data/prisma'])
  assert.equal(
    await readFile(join(resources, 'app-data/prisma/migrations/001.sql'), 'utf8'),
    'select 1;',
  )
})

test('staging reports missing dynamic dependencies and rejects reserved resource destinations', async (t) => {
  const root = await fixture(t)
  const server = join(root, 'server')
  const resources = join(root, 'resources')
  await mkdir(server)
  await writeFile(
    join(server, 'runtime-dependencies.json'),
    JSON.stringify({ version: 1, dependencies: [] }),
  )
  await assert.rejects(
    stageServerDependencies(root, server, resources, {
      appId: 'com.example.fixture',
      productName: 'Fixture',
      bundle: { external: ['missing-runtime-package'] },
    }),
    /production dependency "missing-runtime-package" is not installed/,
  )
  await mkdir(join(root, 'node_modules/broken-workspace'))
  await writeFile(
    join(root, 'node_modules/broken-workspace/package.json'),
    JSON.stringify({
      name: 'broken-workspace',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { types: './src/index.ts', import: './dist/index.js' } },
    }),
  )
  await assert.rejects(
    stageServerDependencies(root, server, resources, {
      appId: 'com.example.fixture',
      productName: 'Fixture',
      bundle: { external: ['broken-workspace'] },
    }),
    /production entry for "broken-workspace" is missing.*Build this workspace\/package/,
  )
  await assert.rejects(
    stageBundleResources(root, resources, {
      appId: 'com.example.fixture',
      productName: 'Fixture',
      bundle: { resources: [{ from: 'package.json', to: 'server/package.json' }] },
    }),
    /unsafe or reserved bundle resource destination/,
  )
  await assert.rejects(
    stageBundleResources(root, resources, {
      appId: 'com.example.fixture',
      productName: 'Fixture',
      bundle: { resources: [{ from: 'package.json', to: '.murasaki-runtime/package.json' }] },
    }),
    /unsafe or reserved bundle resource destination/,
  )

  await writeFile(
    join(server, 'runtime-dependencies.json'),
    JSON.stringify({ version: 1, dependencies: ['ws'] }),
  )
  const foreignTarget = {
    platform: process.platform === 'win32' ? 'darwin' : 'win32',
    arch: process.arch === 'arm64' ? 'x64' : 'arm64',
  }
  await assert.rejects(
    stageServerDependencies(root, server, join(root, 'foreign-resources'), {
      appId: 'com.example.fixture',
      productName: 'Fixture',
    }, foreignTarget),
    /"native-helper" contains native add-ons installed for/,
  )
})
