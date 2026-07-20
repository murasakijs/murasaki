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
  listCapabilities,
  listRecipes,
  listUiComponents,
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
  assert.equal(feature.status, 'stable')
  assert.deepEqual(feature.platforms, { macos: 'supported', windows: 'supported', linux: 'supported' })
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
  assert.equal(schema.properties.capabilities.items.$ref, '#/$defs/nativeCapabilityGrant')
  assert.deepEqual(schema.$defs.nativeCapability.enum, capabilities)
  assert.equal(schema.$defs.nativeCapabilityGrant.oneOf[0].$ref, '#/$defs/nativeCapability')

  const backendPattern = new RegExp(schema.$defs.backendCapability.pattern)
  assert.equal(backendPattern.test('api:POST:/api/documents/*'), true)
  assert.equal(backendPattern.test('main:src/backend/account.ts#loadAccount'), true)
  assert.equal(backendPattern.test('api:get:/private'), false)
  assert.equal(schema.properties.backendCapabilities.items.$ref, '#/$defs/backendCapability')

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

  const updater = schema.properties.updater.oneOf[1].properties
  assert.equal(updater.publicKeys.maxItems, 4)
  assert.equal(updater.maxManifestAgeDays.minimum, 1)
  assert.equal(new RegExp(updater.checkInterval.oneOf[0].pattern).test('6h'), true)
  assert.equal(new RegExp(updater.checkInterval.oneOf[0].pattern).test('0m'), false)
  assert.equal(new RegExp(schema.properties.appId.pattern).test('com.example.app'), true)
  assert.equal(new RegExp(schema.properties.appId.pattern).test('not-portable'), false)
  assert.equal(new RegExp(schema.properties.version.pattern).test('1.2.3-beta.1'), true)
  assert.equal(new RegExp(schema.properties.version.pattern).test('v1.2.3'), false)
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
  assert.equal(result.features[0].maturity, 'stable')
  assert.ok(result.features[0].limitations.length > 0)

  const openRequest = await getApiReference({ symbol: 'MainDefinition.openRequested' })
  assert.equal(openRequest.features.length, 1)
  assert.equal(openRequest.features[0].id, 'single-instance-and-deep-links')
  assert.equal(openRequest.features[0].maturity, 'stable')
})

test('capabilities can be discovered before compatibility checks', async () => {
  const result = await listCapabilities({ platform: 'macos' })
  assert.ok(result.featureIds.includes('tray-and-global-shortcuts'))
  assert.ok(result.features.some((feature) => feature.id === 'auto-update'))
  assert.ok(result.features.every((feature) => feature.platforms.macos))
})

test('config schema supports dot paths and rejects unknown paths', async () => {
  const windowWidth = await getConfigSchema({ path: 'window.width' })
  assert.equal(windowWidth.found, true)
  assert.equal(windowWidth.schema.type, 'integer')

  const missing = await getConfigSchema({ path: 'window.alwaysOnTop' })
  assert.equal(missing.found, false)
  assert.ok(missing.availableProperties.includes('width'))

})

test('compatibility maps platform maturity to a verdict, never over-upgrading', async () => {
  // After the stability declaration every feature.status is "stable" and no
  // feature is "planned" on any platform, so verdicts are now driven purely by
  // the per-platform status. This guard fails loudly if a future feature
  // reintroduces a "planned" value, forcing a conscious update to the
  // planned->verdict expectations here.
  const manifest = JSON.parse(
    await readFile(new URL('../../murasaki/capabilities.json', import.meta.url), 'utf8'),
  )
  const planned = manifest.features.flatMap((feature) =>
    [feature.status, ...Object.values(feature.platforms)]
      .filter((value) => value === 'planned')
      .map(() => feature.id),
  )
  assert.deepEqual(planned, [], `expected no "planned" values, found on: ${planned.join(', ')}`)

  // A stable feature that is "supported" on the target platform verifies as
  // "supported"; native-utilities is supported on all three platforms.
  const supported = await checkCompatibility({ features: ['native-utilities'], platform: 'linux' })
  assert.equal(supported.overall, 'supported')
  assert.equal(supported.results[0].platformStatus, 'supported')
  assert.equal(supported.results[0].verdict, 'supported')

  // A "partial" platform status caps the verdict at "limited" even though the
  // feature itself is stable. tray-and-global-shortcuts is partial on Linux
  // (needs an AppIndicator host, and shortcuts need X11/XWayland); mixing it
  // with a supported feature still drags the overall down to "limited".
  const partial = await checkCompatibility({
    features: ['native-utilities', 'tray-and-global-shortcuts'],
    platform: 'linux',
  })
  assert.equal(partial.overall, 'limited')
  assert.equal(partial.results[0].verdict, 'supported')
  assert.equal(partial.results[1].platformStatus, 'partial')
  assert.equal(partial.results[1].verdict, 'limited')

  // An "unsupported" platform status is never upgraded: system-permissions has
  // no OS equivalent on Linux (unsupported) and is usage-driven on Windows
  // (partial), so those verdicts are "unsupported" and "limited" respectively.
  const linuxPerms = await checkCompatibility({ features: ['system-permissions'], platform: 'linux' })
  assert.equal(linuxPerms.overall, 'unsupported')
  assert.equal(linuxPerms.results[0].platformStatus, 'unsupported')
  assert.equal(linuxPerms.results[0].verdict, 'unsupported')

  const windowsPerms = await checkCompatibility({ features: ['system-permissions'], platform: 'windows' })
  assert.equal(windowsPerms.overall, 'limited')
  assert.equal(windowsPerms.results[0].platformStatus, 'partial')
  assert.equal(windowsPerms.results[0].verdict, 'limited')

  // single-instance-and-deep-links graduated to fully supported on Linux this
  // phase: cold-start argv and second-instance activation forward through the
  // loopback channel, and .deb desktop-file registration is verified, so it now
  // verifies as "supported" rather than the earlier "limited".
  const linux = await checkCompatibility({ features: ['single-instance-and-deep-links'], platform: 'linux' })
  assert.equal(linux.overall, 'supported')
  assert.equal(linux.results[0].platformStatus, 'supported')

  const unknown = await checkCompatibility({ features: ['tray'], platform: 'macos' })
  assert.equal(unknown.overall, 'unknown')
  assert.ok(unknown.availableFeatureIds.includes('tray-and-global-shortcuts'))
  assert.ok(unknown.results[0].suggestions.includes('tray-and-global-shortcuts'))
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

test('UI components are discoverable from the localized generated documentation', async () => {
  const listed = await listUiComponents({ locale: 'en' })
  assert.equal(listed.package, '@murasakijs/ui')
  assert.ok(listed.count >= 35)
  assert.ok(listed.componentIds.includes('button'))
  assert.ok(listed.componentIds.includes('command'))
  assert.ok(listed.componentIds.includes('toast'))

  const filtered = await listUiComponents({ locale: 'ja', query: 'キーボード' })
  assert.ok(filtered.componentIds.includes('kbd'))
  assert.ok(filtered.components.every((component) => component.url.includes('/ja/docs/components/')))
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
    assert.equal(result.assessment, 'structure-only')
    assert.equal(result.runtimeVerified, false)
    assert.ok(result.nextSteps.some((step) => /Launch murasaki dev/.test(step)))
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
