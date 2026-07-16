import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '..', '..')
const manifestPath = join(packageRoot, 'capabilities.json')
const packagePath = join(packageRoot, 'package.json')

const FEATURE_STATUSES = new Set(['stable', 'experimental', 'partial', 'planned'])
const PLATFORM_STATUSES = new Set([
  'supported',
  'partial',
  'development-only',
  'planned',
  'unsupported',
])
const PLATFORM_KEYS = ['macos', 'windows', 'linux']
const FEATURE_KEYS = [
  'id',
  'category',
  'status',
  'platforms',
  'limitations',
  'apiSymbols',
  'testEvidence',
  'docsSlug',
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertStringArray(value, field, featureId, { allowEmpty = true } = {}) {
  assert(Array.isArray(value), `${featureId}.${field} must be an array`)
  if (!allowEmpty) assert(value.length > 0, `${featureId}.${field} must not be empty`)
  const seen = new Set()
  for (const entry of value) {
    assert(typeof entry === 'string' && entry.trim().length > 0, `${featureId}.${field} entries must be non-empty strings`)
    assert(!seen.has(entry), `${featureId}.${field} contains duplicate entry: ${entry}`)
    seen.add(entry)
  }
}

export function validateCapabilities(manifest, frameworkPackage, options = {}) {
  const root = options.repoRoot ?? repoRoot
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'manifest must be an object')
  assert(Number.isInteger(manifest.schemaVersion) && manifest.schemaVersion > 0, 'schemaVersion must be a positive integer')
  assert(typeof manifest.frameworkVersion === 'string', 'frameworkVersion must be a string')
  assert(
    manifest.frameworkVersion === frameworkPackage.version,
    `frameworkVersion ${manifest.frameworkVersion} does not match package version ${frameworkPackage.version}`,
  )
  assert(Array.isArray(manifest.features) && manifest.features.length > 0, 'features must be a non-empty array')

  const ids = new Set()
  for (const feature of manifest.features) {
    assert(feature && typeof feature === 'object' && !Array.isArray(feature), 'each feature must be an object')
    const keys = Object.keys(feature).sort()
    assert(
      JSON.stringify(keys) === JSON.stringify([...FEATURE_KEYS].sort()),
      `${feature.id ?? '<unknown>'} must contain exactly: ${FEATURE_KEYS.join(', ')}`,
    )
    assert(typeof feature.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id), `invalid feature id: ${feature.id}`)
    assert(!ids.has(feature.id), `duplicate feature id: ${feature.id}`)
    ids.add(feature.id)
    assert(typeof feature.category === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.category), `${feature.id}.category must be a kebab-case id`)
    assert(FEATURE_STATUSES.has(feature.status), `${feature.id}.status is invalid: ${feature.status}`)

    assert(feature.platforms && typeof feature.platforms === 'object' && !Array.isArray(feature.platforms), `${feature.id}.platforms must be an object`)
    assert(
      JSON.stringify(Object.keys(feature.platforms).sort()) === JSON.stringify([...PLATFORM_KEYS].sort()),
      `${feature.id}.platforms must contain exactly: ${PLATFORM_KEYS.join(', ')}`,
    )
    for (const platform of PLATFORM_KEYS) {
      assert(
        PLATFORM_STATUSES.has(feature.platforms[platform]),
        `${feature.id}.platforms.${platform} is invalid: ${feature.platforms[platform]}`,
      )
    }

    assertStringArray(feature.limitations, 'limitations', feature.id, { allowEmpty: false })
    assertStringArray(feature.apiSymbols, 'apiSymbols', feature.id)
    assertStringArray(feature.testEvidence, 'testEvidence', feature.id)
    assert(typeof feature.docsSlug === 'string' && (feature.docsSlug === '/docs' || feature.docsSlug.startsWith('/docs/')), `${feature.id}.docsSlug must start with /docs`)

    const docsPath = feature.docsSlug === '/docs'
      ? join(root, 'apps', 'docs', 'content', 'docs', 'index.mdx')
      : join(root, 'apps', 'docs', 'content', 'docs', `${feature.docsSlug.slice('/docs/'.length)}.mdx`)
    assert(existsSync(docsPath), `${feature.id}.docsSlug has no English MDX page: ${feature.docsSlug}`)
    for (const evidence of feature.testEvidence) {
      assert(!evidence.startsWith('/') && !evidence.includes('..'), `${feature.id}.testEvidence must be repo-relative: ${evidence}`)
      assert(existsSync(join(root, evidence)), `${feature.id}.testEvidence does not exist: ${evidence}`)
    }

    if (feature.status === 'planned') {
      assert(feature.apiSymbols.length === 0, `${feature.id} is planned and must not claim public apiSymbols`)
      assert(feature.testEvidence.length === 0, `${feature.id} is planned and must not claim testEvidence`)
      for (const platform of PLATFORM_KEYS) {
        assert(
          feature.platforms[platform] === 'planned' || feature.platforms[platform] === 'unsupported',
          `${feature.id} is planned but ${platform} is marked ${feature.platforms[platform]}`,
        )
      }
    } else if (feature.status === 'stable' || feature.status === 'experimental') {
      assert(feature.testEvidence.length > 0, `${feature.id} is ${feature.status} and must cite testEvidence`)
    }
  }

  return { featureCount: manifest.features.length }
}

export function validateCapabilitiesFiles() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const frameworkPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
  return validateCapabilities(manifest, frameworkPackage)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = validateCapabilitiesFiles()
    process.stdout.write(`capabilities manifest valid (${result.featureCount} features)\n`)
  } catch (error) {
    process.stderr.write(`capabilities manifest invalid: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
