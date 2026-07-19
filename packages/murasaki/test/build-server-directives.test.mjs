import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import buildServer, { stripLeadingMainDirective } from '../dist/cli/build-server.js'

test('stripLeadingMainDirective removes only a leading use main directive without shifting source', () => {
  const source = `\n  'use main';\nexport async function ping() { return 'pong' }\n`
  const stripped = stripLeadingMainDirective(source)

  assert.equal(stripped.length, source.length)
  assert.equal(stripped.split('\n')[1], '             ')
  assert.match(stripped, /export async function ping/)
  assert.equal(stripLeadingMainDirective(`'use custom'\nexport const value = 1\n`), `'use custom'\nexport const value = 1\n`)
})

test('server build consumes use main without emitting Rollup ignored-directive warnings', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-main-directive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(
    join(root, 'src/workspace.ts'),
    `'use main'\nexport async function ping() { return 'pong' }\n`,
  )
  await writeFile(join(root, 'src/main.ts'), `import './other.ts'\nexport default {}\n`)
  await writeFile(join(root, 'src/other.ts'), `'use custom'\nexport const value = 1\n`)

  let output = ''
  const originalWrite = process.stdout.write
  process.stdout.write = function (chunk, ...args) {
    output += String(chunk)
    return true
  }
  try {
    await buildServer(root, join(root, 'src'), {
      appId: 'dev.murasaki.directive-test',
      productName: 'Directive Test',
    })
  } finally {
    process.stdout.write = originalWrite
  }

  assert.doesNotMatch(output, /"use main".*was ignored/)
  assert.match(output, /"use custom".*was ignored/)
  const registry = await readFile(join(root, 'dist/server/main-actions.mjs'), 'utf8')
  assert.match(registry, /workspace\.ts/)
})

test('server build keeps aliases and transforms but isolates client-only output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-server-config-isolation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(
    join(root, 'vite.config.mjs'),
    `import { resolve } from 'node:path'
export default {
  resolve: { alias: { '@app': resolve(import.meta.dirname, 'src') } },
  plugins: [{
    name: 'fixture:server-transform',
    transform(code, id) {
      return id.endsWith('/src/lib/value.ts') ? code.replace('ORIGINAL', 'TRANSFORMED') : null
    },
  }],
  build: { rollupOptions: { output: { manualChunks: { broken: ['client-only-external'] } } } },
}\n`,
  )
  await mkdir(join(root, 'src/lib'), { recursive: true })
  await writeFile(join(root, 'src/lib/value.ts'), `export const value = 'ORIGINAL'\n`)
  await writeFile(
    join(root, 'src/main.ts'),
    `import { value } from '@app/lib/value'\nexport default { ready() { return value } }\n`,
  )

  await buildServer(root, join(root, 'src'), {
    appId: 'dev.murasaki.server-config-isolation',
    productName: 'Server Config Isolation',
  })

  const main = await readFile(join(root, 'dist/server/main.mjs'), 'utf8')
  assert.match(main, /ready/)
  assert.match(main, /TRANSFORMED/)
  assert.doesNotMatch(main, /@app\/lib/)

  const dependencies = await readFile(join(root, 'dist/server/runtime-dependencies.json'), 'utf8')
  assert.doesNotMatch(dependencies, /@app\/lib/)
})

test('server build preserves the framework-owned @ source alias', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-server-core-alias-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src/lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(root, 'src/lib/value.ts'), `export const value = 'core-alias'\n`)
  await writeFile(
    join(root, 'src/main.ts'),
    `import { value } from '@/lib/value'\nexport default { ready() { return value } }\n`,
  )

  await buildServer(root, join(root, 'src'), {
    appId: 'dev.murasaki.server-core-alias',
    productName: 'Server Core Alias',
  })

  const main = await readFile(join(root, 'dist/server/main.mjs'), 'utf8')
  assert.match(main, /core-alias/)
  assert.doesNotMatch(main, /@\/lib/)
})
