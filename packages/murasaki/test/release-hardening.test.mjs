import assert from 'node:assert/strict'
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as verifyEd25519,
} from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import release from '../dist/cli/release.js'
import installer from '../dist/cli/installer.js'

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * `release()`/`installer()` read `process.cwd()` directly (they're CLI entry
 * points, not pure functions taking a project root) — chdir into a fresh
 * temp project for the duration of one test, then restore. Safe because
 * node:test runs the tests within one file sequentially by default, so the
 * restore always completes before the next test's setup runs.
 */
async function withTempProject(t, configSource) {
  const originalCwd = process.cwd()
  const root = await mkdtemp(join(tmpdir(), 'murasaki-release-test-'))
  await writeFile(join(root, 'murasaki.config.mjs'), configSource)
  process.chdir(root)
  t.after(async () => {
    process.chdir(originalCwd)
    await rm(root, { recursive: true, force: true })
  })
  return root
}

test('release --manifest scans arch-suffixed win32 names and falls back to the legacy name', async (t) => {
  const root = await withTempProject(
    t,
    `export default { appId: 'dev.test.release-arch', productName: 'ReleaseArchApp' }\n`,
  )
  await mkdir(join(root, 'dist'), { recursive: true })
  // Legacy (pre-arch-suffix) win32-x64 name only -- no new-style x64 file present.
  await writeFile(join(root, 'dist/ReleaseArchApp-1.0.0-setup.exe'), 'legacy-x64-fixture')
  // New arch-suffixed win32-arm64 name.
  await writeFile(join(root, 'dist/ReleaseArchApp-1.0.0-setup-arm64.exe'), 'arm64-fixture')

  await release(['--manifest', '--base-url', 'https://updates.example.com', '--version', '1.0.0'])

  const manifest = JSON.parse(await readFile(join(root, 'dist/latest.json'), 'utf8'))
  assert.equal(manifest.assets['win32-x64'].url, 'https://updates.example.com/ReleaseArchApp-1.0.0-setup.exe')
  assert.equal(
    manifest.assets['win32-arm64'].url,
    'https://updates.example.com/ReleaseArchApp-1.0.0-setup-arm64.exe',
  )
  assert.equal(manifest.assets['darwin-arm64'], undefined)
  assert.equal(manifest.assets['darwin-x64'], undefined)
})

test('release --manifest rejects malformed versions and insecure publication URLs before scanning artifacts', async (t) => {
  await withTempProject(
    t,
    `export default { appId: 'dev.test.release-validation', productName: 'ReleaseValidation' }\n`,
  )

  await assert.rejects(
    release(['--manifest', '--base-url', 'https://updates.example.com', '--version', '1.2.3garbage']),
    /valid semantic version/,
  )
  await assert.rejects(
    release(['--manifest', '--base-url', 'http://updates.example.com', '--version', '1.2.3']),
    /credential-free HTTPS/,
  )
  await assert.rejects(
    release(['--manifest', '--base-url', 'https://user:secret@updates.example.com', '--version', '1.2.3']),
    /credential-free HTTPS/,
  )
})

test('release --manifest prefers the arch-suffixed win32-x64 name when both it and the legacy name exist', async (t) => {
  const root = await withTempProject(
    t,
    `export default { appId: 'dev.test.release-arch-both', productName: 'BothNamesApp' }\n`,
  )
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist/BothNamesApp-2.0.0-setup-x64.exe'), 'new-name-fixture')
  await writeFile(join(root, 'dist/BothNamesApp-2.0.0-setup.exe'), 'legacy-fixture')

  await release(['--manifest', '--base-url', 'https://updates.example.com', '--version', '2.0.0'])

  const manifest = JSON.parse(await readFile(join(root, 'dist/latest.json'), 'utf8'))
  assert.equal(manifest.assets['win32-x64'].url, 'https://updates.example.com/BothNamesApp-2.0.0-setup-x64.exe')
  assert.equal(
    manifest.assets['win32-x64'].sha256,
    createHash('sha256').update('new-name-fixture').digest('hex'),
  )
})

test('release --manifest writes generatedAt and --rollout writes an optional rollout percentage', async (t) => {
  const root = await withTempProject(
    t,
    `export default { appId: 'dev.test.release-rollout', productName: 'RolloutApp' }\n`,
  )
  await mkdir(join(root, 'dist/bundle'), { recursive: true })
  await writeFile(join(root, 'dist/bundle/RolloutApp-darwin-arm64.app.zip'), 'fixture')

  const before = Date.now()
  await release([
    '--manifest',
    '--base-url',
    'https://updates.example.com',
    '--version',
    '1.0.0',
    '--rollout',
    '25',
  ])
  const after = Date.now()

  let manifest = JSON.parse(await readFile(join(root, 'dist/latest.json'), 'utf8'))
  assert.equal(manifest.rollout, 25)
  assert.equal(manifest.generatedAt, manifest.publishedAt)
  const generatedMs = Date.parse(manifest.generatedAt)
  assert.ok(generatedMs >= before && generatedMs <= after)

  await release(['--manifest', '--base-url', 'https://updates.example.com', '--version', '1.0.1'])
  manifest = JSON.parse(await readFile(join(root, 'dist/latest.json'), 'utf8'))
  assert.equal('rollout' in manifest, false)
})

test('release --sign injects a keyId hint when the public key file is available', async (t) => {
  const root = await withTempProject(
    t,
    `export default { appId: 'dev.test.release-keyid', productName: 'KeyIdApp' }\n`,
  )
  await mkdir(join(root, 'dist/bundle'), { recursive: true })
  await writeFile(join(root, 'dist/bundle/KeyIdApp-darwin-arm64.app.zip'), 'fixture')
  await release(['--manifest', '--base-url', 'https://updates.example.com', '--version', '1.0.0'])
  await release(['--keygen'])

  await release(['--sign'])

  const manifest = JSON.parse(await readFile(join(root, 'dist/latest.json'), 'utf8'))
  const pubB64 = (await readFile(join(root, '.murasaki/update-key.pub'), 'utf8')).trim()
  const expectedKeyId = createHash('sha256').update(Buffer.from(pubB64, 'base64')).digest('hex').slice(0, 16)
  assert.equal(manifest.keyId, expectedKeyId)

  // The signature must verify against the exact (rewritten) bytes on disk --
  // keyId injection happens before signing, not after.
  const rawManifestBytes = await readFile(join(root, 'dist/latest.json'))
  const sigB64 = await readFile(join(root, 'dist/latest.json.sig'), 'utf8')
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(pubB64, 'base64')]),
    format: 'der',
    type: 'spki',
  })
  assert.equal(verifyEd25519(null, rawManifestBytes, publicKey, Buffer.from(sigB64, 'base64')), true)
})

test('release --sign leaves the manifest unmodified when no public key file is available', async (t) => {
  const root = await withTempProject(
    t,
    `export default { appId: 'dev.test.release-nokeyid', productName: 'NoKeyIdApp' }\n`,
  )
  await mkdir(join(root, 'dist/bundle'), { recursive: true })
  await writeFile(join(root, 'dist/bundle/NoKeyIdApp-darwin-arm64.app.zip'), 'fixture')
  await release(['--manifest', '--base-url', 'https://updates.example.com', '--version', '1.0.0'])
  const before = await readFile(join(root, 'dist/latest.json'), 'utf8')

  const { privateKey } = generateKeyPairSync('ed25519')
  const der = privateKey.export({ format: 'der', type: 'pkcs8' })
  const seedB64 = der.subarray(der.length - 32).toString('base64')

  const previousEnv = process.env.MURASAKI_UPDATE_KEY
  process.env.MURASAKI_UPDATE_KEY = seedB64
  try {
    assert.equal(existsSync(join(root, '.murasaki/update-key.pub')), false)
    await release(['--sign'])
  } finally {
    if (previousEnv === undefined) delete process.env.MURASAKI_UPDATE_KEY
    else process.env.MURASAKI_UPDATE_KEY = previousEnv
  }

  const after = await readFile(join(root, 'dist/latest.json'), 'utf8')
  assert.equal(after, before)
  assert.equal(JSON.parse(after).keyId, undefined)
  assert.ok(existsSync(join(root, 'dist/latest.json.sig')))
})

test('installer --target win32-<arch> names the NSIS installer with an arch suffix', { skip: spawnSync('makensis', ['-VERSION']).error ? 'makensis is not installed' : false }, async (t) => {
  const root = await withTempProject(
    t,
    `export default { appId: 'dev.test.installer-arch', productName: 'ArchTestApp' }\n`,
  )
  for (const arch of ['x64', 'arm64']) {
    const bundleDir = join(root, 'dist/bundle/ArchTestApp')
    await rm(join(root, 'dist'), { recursive: true, force: true })
    await mkdir(bundleDir, { recursive: true })
    await writeFile(join(bundleDir, 'ArchTestApp.exe'), 'fixture')
    await writeFile(join(bundleDir, 'metadata.json'), '{}')

    await installer(['--target', `win32-${arch}`, '--no-build'])

    const setupPath = join(root, `dist/ArchTestApp-0.0.0-setup-${arch}.exe`)
    assert.ok(existsSync(setupPath), `expected ${setupPath} to exist`)
  }
})

test('Windows installer fails closed when no installer tool produced an artifact', async (t) => {
  const root = await withTempProject(
    t,
    `export default { appId: 'dev.test.no-installer', productName: 'NoInstallerApp' }\n`,
  )
  const bundleDir = join(root, 'dist/bundle/NoInstallerApp')
  await mkdir(bundleDir, { recursive: true })
  await writeFile(join(bundleDir, 'NoInstallerApp.exe'), 'fixture')
  await writeFile(join(bundleDir, 'metadata.json'), '{}')
  const oldPath = process.env.PATH
  const oldNsisPath = process.env.MURASAKI_NSIS_PATH
  const oldWixPath = process.env.MURASAKI_WIX_PATH
  process.env.PATH = join(root, 'empty-path')
  process.env.MURASAKI_NSIS_PATH = join(root, 'missing-makensis')
  process.env.MURASAKI_WIX_PATH = join(root, 'missing-wix')
  try {
    await assert.rejects(
      installer(['--target', 'win32-x64', '--no-build']),
      /no Windows installer produced/,
    )
  } finally {
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    if (oldNsisPath === undefined) delete process.env.MURASAKI_NSIS_PATH
    else process.env.MURASAKI_NSIS_PATH = oldNsisPath
    if (oldWixPath === undefined) delete process.env.MURASAKI_WIX_PATH
    else process.env.MURASAKI_WIX_PATH = oldWixPath
  }
})
