import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEMO_SPECS,
  checksumForAsset,
  demoAssetName,
  resolveDemoTarget,
} from '../dist/cli/demo.js'

test('resolves native macOS targets', () => {
  assert.equal(resolveDemoTarget('darwin', 'arm64'), 'darwin-arm64')
  assert.equal(resolveDemoTarget('darwin', 'x64'), 'darwin-x64')
  assert.throws(() => resolveDemoTarget('linux', 'x64'), /macOS only/)
})

test('builds immutable release asset names', () => {
  assert.equal(
    demoAssetName(DEMO_SPECS.default, 'darwin-x64'),
    'MurasakiDemo-0.47.3-darwin-x64.dmg',
  )
  assert.equal(
    demoAssetName(DEMO_SPECS.papelle, 'darwin-arm64'),
    'Papelle-0.55.5-darwin-arm64.dmg',
  )
  assert.equal(
    demoAssetName(DEMO_SPECS.oscilla, 'darwin-x64'),
    'Oscilla-0.55.5-darwin-x64.dmg',
  )
  assert.equal(
    demoAssetName(DEMO_SPECS.orglia, 'darwin-arm64'),
    'Orglia-0.55.5-darwin-arm64.dmg',
  )
  assert.deepEqual(Object.keys(DEMO_SPECS), ['default', 'papelle', 'oscilla', 'orglia'])
})

test('selects the checksum for the exact asset', () => {
  const digest = 'a'.repeat(64)
  const contents = `${'b'.repeat(64)}  other.dmg\n${digest}  wanted.dmg\n`
  assert.equal(checksumForAsset(contents, 'wanted.dmg'), digest)
  assert.equal(checksumForAsset(contents, 'missing.dmg'), undefined)
})
