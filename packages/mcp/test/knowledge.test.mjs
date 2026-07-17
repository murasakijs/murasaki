import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkCompatibility,
  doctor,
  getApiReference,
  getConfigSchema,
  getRecipe,
  isSupportedMurasakiNodeVersion,
  listRecipes,
  searchDocs,
} from '../src/knowledge.mjs'

test('generated capability knowledge exactly matches the canonical manifest', async () => {
  const [canonical, generated] = await Promise.all([
    readFile(new URL('../../murasaki/capabilities.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../content/capabilities.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  assert.deepEqual(generated, canonical)

  const feature = canonical.features.find((candidate) => candidate.id === 'single-instance-and-deep-links')
  assert.ok(feature)
  assert.equal(feature.status, 'partial')
  assert.deepEqual(feature.platforms, { macos: 'supported', windows: 'supported', linux: 'partial' })
  for (const symbol of [
    'ProtocolConfig',
    'FileAssociationConfig',
    'OpenRequestEvent',
    'OpenTarget',
    'MainDefinition.openRequested',
  ]) {
    assert.ok(feature.apiSymbols.includes(symbol), `missing API symbol ${symbol}`)
  }
  assert.match(feature.limitations.join('\n'), /portable/i)
})

test('configuration schema top-level properties track MurasakiConfig', async () => {
  const [source, schema] = await Promise.all([
    readFile(new URL('../../murasaki/src/config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../content/config-schema.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  const start = source.indexOf('export interface MurasakiConfig {')
  assert.notEqual(start, -1)
  const fields = []
  let depth = 0
  for (const line of source.slice(start).split('\n')) {
    if (depth === 1) {
      const match = /^  ([A-Za-z][A-Za-z0-9]*)\??:/.exec(line)
      if (match) fields.push(match[1])
    }
    depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length
    if (depth === 0) break
  }
  assert.deepEqual(Object.keys(schema.properties).sort(), fields.sort())

  const capabilityStart = source.indexOf('export const NATIVE_CAPABILITIES = [')
  assert.notEqual(capabilityStart, -1)
  const capabilitySource = source.slice(capabilityStart, source.indexOf('] as const', capabilityStart))
  const capabilities = [...capabilitySource.matchAll(/^  '([^']+)',?$/gm)].map((match) => match[1])
  assert.deepEqual(schema.properties.capabilities.items.enum, capabilities)
  assert.deepEqual(schema.$defs.nativeCapability.enum, capabilities)

  const cspPattern = new RegExp(schema.properties.security.properties.csp.oneOf[0].pattern)
  assert.equal(cspPattern.test('   '), false)
  assert.equal(cspPattern.test("default-src 'self'"), true)

  assert.deepEqual(schema.properties.protocols.items.required, ['scheme'])
  assert.equal(schema.properties.protocols.items.properties.scheme.type, 'string')
  assert.deepEqual(schema.properties.fileAssociations.items.required, ['extensions'])
  assert.equal(schema.properties.fileAssociations.items.properties.extensions.minItems, 1)
  assert.deepEqual(schema.properties.fileAssociations.items.properties.role.enum, ['viewer', 'editor', 'shell', 'none'])
  assert.equal(schema.$defs.windowConfig.properties.createOnLaunch.type, 'boolean')
  assert.equal(schema.$defs.windowConfig.properties.createOnLaunch.default, true)
})

test('search_docs returns canonical localized documentation', async () => {
  const result = await searchDocs({ query: 'server actions', locale: 'en', limit: 3 })
  assert.ok(result.results.length > 0)
  assert.match(result.results[0].url, /^https:\/\/murasaki\.ichi10\.com\/docs\//)
  assert.ok(result.results.some((entry) => entry.slug === 'guides/server-actions'))
})

test('API reference preserves canonical maturity and limitations', async () => {
  const result = await getApiReference({ symbol: 'useUpdate' })
  assert.equal(result.features.length, 1)
  assert.equal(result.features[0].id, 'auto-update')
  assert.equal(result.features[0].maturity, 'partial')
  assert.ok(result.features[0].limitations.length > 0)

  const openRequest = await getApiReference({ symbol: 'MainDefinition.openRequested' })
  assert.equal(openRequest.features.length, 1)
  assert.equal(openRequest.features[0].id, 'single-instance-and-deep-links')
  assert.equal(openRequest.features[0].maturity, 'partial')
})

test('config schema supports dot paths and rejects unknown paths', async () => {
  const windowWidth = await getConfigSchema({ path: 'window.width' })
  assert.equal(windowWidth.found, true)
  assert.equal(windowWidth.schema.type, 'integer')

  const missing = await getConfigSchema({ path: 'window.alwaysOnTop' })
  assert.equal(missing.found, false)
  assert.ok(missing.availableProperties.includes('width'))

})

test('compatibility never upgrades planned features to supported', async () => {
  // linux-distribution graduated to "partial" this phase (RFC 0002 L2a) —
  // code-signing is still genuinely "planned" on Linux, so it now carries
  // this test's "never upgrades planned to supported" scenario instead.
  const result = await checkCompatibility({ features: ['code-signing', 'native-utilities'], platform: 'linux' })
  assert.equal(result.overall, 'planned')
  assert.equal(result.results[0].verdict, 'planned')
  assert.equal(result.results[1].verdict, 'limited')

  const macos = await checkCompatibility({ features: ['single-instance-and-deep-links'], platform: 'macos' })
  assert.equal(macos.overall, 'limited')
  assert.equal(macos.results[0].platformStatus, 'supported')

  const windows = await checkCompatibility({ features: ['single-instance-and-deep-links'], platform: 'windows' })
  assert.equal(windows.overall, 'limited')
  assert.equal(windows.results[0].platformStatus, 'supported')

  // Linux graduated from "planned" to "partial" this phase too (cold-start
  // argv + second-instance forwarding now work) — no longer a "planned"
  // verdict, but still not "supported" (feature.status is "partial", and no
  // OS-level association registration exists for a manually-extracted
  // AppDir the way NSIS/MSI provide on Windows).
  const linux = await checkCompatibility({ features: ['single-instance-and-deep-links'], platform: 'linux' })
  assert.equal(linux.overall, 'limited')
  assert.equal(linux.results[0].platformStatus, 'partial')
})

test('recipes are sourced from localized documentation with English fallback', async () => {
  const listed = await listRecipes({ locale: 'ja' })
  assert.ok(listed.recipes.some((recipe) => recipe.id === 'routing'))
  assert.ok(listed.recipes.some((recipe) => recipe.id === 'deep-links-and-file-associations'))
  assert.ok(listed.recipes.some((recipe) => recipe.id === 'multi-window-permissions'))
  assert.ok(listed.recipes.some((recipe) => recipe.id === 'node-main-lifecycle'))
  assert.ok(listed.recipes.some((recipe) => recipe.id === 'tray-icon'))
  assert.ok(listed.recipes.some((recipe) => recipe.id === 'security-and-csp'))
  const recipe = await getRecipe({ id: 'routing', locale: 'ja' })
  assert.equal(recipe.found, true)
  assert.equal(recipe.locale, 'ja')
  assert.match(recipe.content, /ルーティング|ルート/)

  const openRequestRecipe = await getRecipe({ id: 'deep-links-and-file-associations', locale: 'en' })
  assert.equal(openRequestRecipe.found, true)
  assert.equal(openRequestRecipe.slug, 'guides/deep-links')

  const nodeMainRecipe = await getRecipe({ id: 'node-main-lifecycle', locale: 'en' })
  assert.equal(nodeMainRecipe.found, true)
  assert.equal(nodeMainRecipe.slug, 'guides/node-main')

  const trayRecipe = await getRecipe({ id: 'tray-icon', locale: 'en' })
  assert.equal(trayRecipe.found, true)
  assert.equal(trayRecipe.slug, 'guides/native-apis')

  const securityRecipe = await getRecipe({ id: 'security-and-csp', locale: 'en' })
  assert.equal(securityRecipe.found, true)
  assert.equal(securityRecipe.slug, 'building/security')
})

test('doctor inspects known project files without executing project code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-mcp-doctor-'))
  try {
    await mkdir(join(root, 'src/app'), { recursive: true })
    await Promise.all([
      writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { murasaki: '^0.48.0' }, scripts: { dev: 'murasaki dev' } })),
      writeFile(join(root, 'murasaki.config.ts'), 'throw new Error("doctor must not execute this")\n'),
      writeFile(join(root, 'src/app/layout.tsx'), 'export default function Layout({children}) { return children }\n'),
      writeFile(join(root, 'src/app/page.tsx'), 'export default function Page() { return null }\n'),
    ])
    const result = await doctor({ projectPath: root })
    assert.equal(result.overall, 'pass')
    assert.ok(result.checks.every((check) => check.status === 'pass'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Murasaki Node support begins at 22.12.0', () => {
  assert.equal(isSupportedMurasakiNodeVersion('20.19.0'), false)
  assert.equal(isSupportedMurasakiNodeVersion('22.11.0'), false)
  assert.equal(isSupportedMurasakiNodeVersion('22.12.0'), true)
  assert.equal(isSupportedMurasakiNodeVersion('22.12.0-rc.1'), true)
  assert.equal(isSupportedMurasakiNodeVersion('23.0.0'), true)
  assert.equal(isSupportedMurasakiNodeVersion('not-a-version'), false)
})
