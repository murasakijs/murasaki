import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { defineConfig } from '../dist/config.js'
import {
  detectDpkgSig,
  detectGpg,
  embedDebSignatureIfAvailable,
  gpgDetachSignArgs,
  gpgVerifyArgs,
  resolveLinuxSigningOptions,
  signLinuxArtifact,
  writeSha256Sums,
} from '../dist/cli/linux-signing.js'

const baseConfig = { appId: 'dev.test.linux-signed', productName: 'Signed Linux App' }

async function withTempDir(t) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-linux-signing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

// ── key selection precedence ────────────────────────────────────────────

test('$MURASAKI_GPG_KEY overrides sign.linux.gpgKey', () => {
  const config = { ...baseConfig, sign: { linux: { gpgKey: 'config-key' } } }
  assert.equal(resolveLinuxSigningOptions(config, {}).gpgKey, 'config-key')
  assert.equal(
    resolveLinuxSigningOptions(config, { MURASAKI_GPG_KEY: 'env-key' }).gpgKey,
    'env-key',
  )
})

test('a --sign request with no resolvable key throws an actionable error', () => {
  assert.throws(
    () => resolveLinuxSigningOptions(baseConfig, {}),
    /requires a GPG signing key.*MURASAKI_GPG_KEY.*sign\.linux\.gpgKey/s,
  )
})

test('the passphrase is only ever read from the environment, never config', () => {
  const config = { ...baseConfig, sign: { linux: { gpgKey: 'config-key' } } }
  const options = resolveLinuxSigningOptions(config, { MURASAKI_GPG_PASSPHRASE: 'shh' })
  assert.equal(options.passphrase, 'shh')
  assert.equal(resolveLinuxSigningOptions(config, {}).passphrase, undefined)
})

// ── sign-command construction ───────────────────────────────────────────

test('gpg detach-sign arguments omit passphrase-fd when no passphrase is configured', () => {
  const args = gpgDetachSignArgs('/dist/App.AppImage', '/dist/App.AppImage.sig', { gpgKey: 'CI Key <ci@example.com>' })
  assert.deepEqual(args, [
    '--batch', '--yes',
    '--local-user', 'CI Key <ci@example.com>',
    '--detach-sign', '--armor',
    '--output', '/dist/App.AppImage.sig',
    '/dist/App.AppImage',
  ])
})

test('gpg detach-sign arguments add loopback passphrase-fd when a passphrase is configured', () => {
  const args = gpgDetachSignArgs('/dist/App.AppImage', '/dist/App.AppImage.sig', {
    gpgKey: 'CI Key <ci@example.com>',
    passphrase: 'shh',
  })
  assert.deepEqual(args, [
    '--batch', '--yes',
    '--pinentry-mode', 'loopback', '--passphrase-fd', '0',
    '--local-user', 'CI Key <ci@example.com>',
    '--detach-sign', '--armor',
    '--output', '/dist/App.AppImage.sig',
    '/dist/App.AppImage',
  ])
})

test('gpg verify arguments', () => {
  assert.deepEqual(
    gpgVerifyArgs('/dist/App.AppImage.sig', '/dist/App.AppImage'),
    ['--verify', '/dist/App.AppImage.sig', '/dist/App.AppImage'],
  )
})

// ── refusal → implemented transition ────────────────────────────────────
// `bundle --sign`/`installer --sign` on Linux used to hard-refuse
// unconditionally (see git history). Now `--sign` is real GPG signing:
// a missing key is a clean, actionable error (above), and signing a real
// artifact fails only for a genuinely missing file or tool, never a blanket
// "not implemented" refusal.

test('signLinuxArtifact refuses to sign a missing artifact (not a blanket --sign refusal)', () => {
  assert.throws(
    () => signLinuxArtifact('/nonexistent/dist/App.AppImage', {
      ...baseConfig,
      sign: { linux: { gpgKey: 'whatever' } },
    }),
    /cannot sign missing Linux artifact/,
  )
})

test('signLinuxArtifact surfaces the missing-key error before ever touching gpg', async (t) => {
  const root = await withTempDir(t)
  const artifact = join(root, 'App.AppImage')
  await writeFile(artifact, 'fixture')
  assert.throws(
    () => signLinuxArtifact(artifact, baseConfig, {}),
    /requires a GPG signing key/,
  )
})

// ── opportunistic dpkg-sig embedding ────────────────────────────────────

test('embedDebSignatureIfAvailable is a no-op (never throws) when dpkg-sig is not on PATH', () => {
  const result = embedDebSignatureIfAvailable('/nonexistent/App.deb', { gpgKey: 'whatever' }, { PATH: '' })
  assert.equal(result, 'none')
  assert.equal(detectDpkgSig({ PATH: '' }), false)
})

// ── SHA256SUMS ───────────────────────────────────────────────────────────

test('writeSha256Sums writes sha256sum-compatible entries', async (t) => {
  const root = await withTempDir(t)
  await writeFile(join(root, 'app.deb'), 'deb-fixture')
  const sumsPath = join(root, 'SHA256SUMS')
  await writeSha256Sums(sumsPath, [{ absPath: join(root, 'app.deb'), relPath: 'app.deb' }])

  const expected = createHash('sha256').update('deb-fixture').digest('hex')
  assert.equal(await readFile(sumsPath, 'utf8'), `${expected}  app.deb\n`)

  // Verified with the real coreutils tool when it happens to be on PATH.
  const check = spawnSync('sha256sum', ['--check', 'SHA256SUMS'], { cwd: root, encoding: 'utf8' })
  if (!check.error) assert.equal(check.status, 0, check.stdout + check.stderr)
})

test('writeSha256Sums writes an empty file for no entries', async (t) => {
  const root = await withTempDir(t)
  const sumsPath = join(root, 'SHA256SUMS')
  await writeSha256Sums(sumsPath, [])
  assert.equal(await readFile(sumsPath, 'utf8'), '')
})

// ── config validation ───────────────────────────────────────────────────

test('sign.linux.gpgKey config validation', () => {
  assert.doesNotThrow(() => defineConfig({ ...baseConfig, sign: { linux: { gpgKey: 'AB12CD34' } } }))
  assert.doesNotThrow(() => defineConfig({ ...baseConfig, sign: {} }))
  assert.throws(
    () => defineConfig({ ...baseConfig, sign: { linux: { gpgKey: '' } } }),
    /sign\.linux\.gpgKey must be a non-empty string/,
  )
  assert.throws(
    () => defineConfig({ ...baseConfig, sign: { linux: 'nope' } }),
    /sign\.linux must be an object/,
  )
})

// ── real ephemeral-key round trip (skips gracefully without gpg) ────────

test('a detached GPG signature verifies against the signed artifact and fails after tampering', async (t) => {
  if (!detectGpg()) {
    t.skip('gpg is not installed on this host')
    return
  }

  const gnupgHome = await withTempDir(t)
  const root = await withTempDir(t)
  const env = { ...process.env, GNUPGHOME: gnupgHome }

  const genKey = spawnSync('gpg', [
    '--batch', '--pinentry-mode', 'loopback', '--passphrase', '',
    '--quick-generate-key', 'Murasaki Test <test@example.com>', 'default', 'default', 'never',
  ], { encoding: 'utf8', env })
  if (genKey.status !== 0) {
    t.skip(`could not generate an ephemeral GPG key: ${genKey.stderr}`)
    return
  }

  const artifactPath = join(root, 'App-1.0.0-linux-x64.AppImage')
  await writeFile(artifactPath, 'fixture AppImage payload')

  const config = { ...baseConfig, sign: { linux: { gpgKey: 'test@example.com' } } }
  const sigPath = signLinuxArtifact(artifactPath, config, env)
  assert.ok(existsSync(sigPath))

  const verifyOk = spawnSync('gpg', gpgVerifyArgs(sigPath, artifactPath), { encoding: 'utf8', env })
  assert.equal(verifyOk.status, 0, verifyOk.stderr)

  // Tampering with the signed artifact must break verification.
  await writeFile(artifactPath, 'tampered payload')
  const verifyTampered = spawnSync('gpg', gpgVerifyArgs(sigPath, artifactPath), { encoding: 'utf8', env })
  assert.notEqual(verifyTampered.status, 0)
})
