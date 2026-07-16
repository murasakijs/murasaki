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
  const invalid = structuredClone(manifest)
  const planned = invalid.features.find((feature) => feature.status === 'planned')
  assert.ok(planned)
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
