import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  validateCapabilities,
  validateCapabilitiesFiles,
} from '../scripts/validate-capabilities.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageRoot, '..', '..')
const frameworkPackage = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'capabilities.json'), 'utf8'))

test('the checked-in capabilities manifest is valid', () => {
  const result = validateCapabilitiesFiles()
  assert.equal(result.featureCount, manifest.features.length)
})

test('planned features cannot claim shipping platform support', () => {
  // Synthesized rather than found in the live manifest: which (if any) real
  // feature has overall status "planned" varies release to release (e.g.
  // linux-distribution graduated to "partial" in RFC 0002 phase L2a), so
  // this constructs the invalid shape directly instead of depending on one
  // existing.
  const invalid = structuredClone(manifest)
  const planned = invalid.features[0]
  planned.status = 'planned'
  planned.apiSymbols = []
  planned.testEvidence = []
  planned.platforms = { macos: 'planned', windows: 'planned', linux: 'planned' }
  planned.platforms.macos = 'supported'

  assert.throws(
    () => validateCapabilities(invalid, frameworkPackage, { repoRoot }),
    /is planned but macos is marked supported/,
  )
})

test('framework version drift is rejected', () => {
  const invalid = structuredClone(manifest)
  invalid.frameworkVersion = '0.0.0'
  assert.throws(
    () => validateCapabilities(invalid, frameworkPackage, { repoRoot }),
    /does not match package version/,
  )
})
