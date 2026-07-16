import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { defineConfig } from '../dist/config.js'
import {
  resolveWindowsSigningOptions,
  windowsSignArgs,
  windowsVerifyArgs,
} from '../dist/cli/windows-signing.js'

const baseConfig = { appId: 'dev.test.signed', productName: 'Signed App' }

test('Windows signing defaults to a timestamped certificate-store signature', () => {
  const options = resolveWindowsSigningOptions(baseConfig, process.cwd(), {})
  assert.equal(options.certificateStore, 'currentUser')
  assert.equal(options.timestampUrl, 'http://timestamp.digicert.com')
  assert.equal(options.allowUntrustedCiCertificate, false)
  assert.deepEqual(
    windowsSignArgs('C:\\release\\Signed App.exe', 'Signed App', options),
    [
      'sign', '/v', '/fd', 'SHA256', '/d', 'Signed App', '/a',
      '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256',
      'C:\\release\\Signed App.exe',
    ],
  )
  assert.deepEqual(
    windowsVerifyArgs('C:\\release\\Signed App.exe', options),
    ['verify', '/pa', '/v', '/tw', 'C:\\release\\Signed App.exe'],
  )
})
test('PFX password stays in the environment and timestamping can be disabled', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-signing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'release.pfx'), 'test fixture')

  const options = resolveWindowsSigningOptions(
    {
      ...baseConfig,
      sign: { windows: { certificateFile: 'release.pfx', timestampUrl: false } },
    },
    root,
    { MURASAKI_WINDOWS_CERTIFICATE_PASSWORD: 'not-in-config' },
  )
  const args = windowsSignArgs('app.exe', 'Signed App', options)
  assert.deepEqual(args.slice(0, 8), [
    'sign', '/v', '/fd', 'SHA256', '/d', 'Signed App', '/a', '/f',
  ])
  assert.equal(args.at(-1), 'app.exe')
  assert.equal(args.includes('/tr'), false)
  assert.equal(args[args.indexOf('/p') + 1], 'not-in-config')
  assert.deepEqual(windowsVerifyArgs('app.exe', options), ['verify', '/pa', '/v', 'app.exe'])
})

test('Microsoft Artifact Signing uses the dlib provider and its timestamp authority', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-artifact-signing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'Azure.CodeSigning.Dlib.dll'), 'test fixture')
  await writeFile(join(root, 'metadata.json'), '{}')

  const options = resolveWindowsSigningOptions({
    ...baseConfig,
    sign: {
      windows: {
        artifactSigning: {
          dlib: 'Azure.CodeSigning.Dlib.dll',
          metadata: 'metadata.json',
        },
      },
    },
  }, root, {})
  assert.equal(options.timestampUrl, 'http://timestamp.acs.microsoft.com')
  const args = windowsSignArgs('setup.exe', 'Signed App', options)
  assert.ok(args.includes('/debug'))
  assert.equal(args[args.indexOf('/dlib') + 1], join(root, 'Azure.CodeSigning.Dlib.dll'))
  assert.equal(args[args.indexOf('/dmdf') + 1], join(root, 'metadata.json'))
  assert.equal(args.includes('/a'), false)
})

test('Windows signing rejects ambiguous or unsafe configuration', () => {
  const invalid = [
    {
      sign: { windows: { certificateFile: 'release.pfx', certificateSubjectName: 'Example' } },
      message: /mutually exclusive/,
    },
    {
      sign: { windows: { certificateSha1: '1234' } },
      message: /40-character SHA-1/,
    },
    {
      sign: { windows: { timestampUrl: 'file:///tmp/time' } },
      message: /HTTP\(S\) URL/,
    },
    {
      sign: { windows: { artifactSigning: { dlib: 'provider.dll', metadata: '' } } },
      message: /artifactSigning\.metadata/,
    },
  ]
  for (const { sign, message } of invalid) {
    assert.throws(() => defineConfig({ ...baseConfig, sign }), message)
  }
})

test('environment certificate selectors are mutually exclusive', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-signing-env-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'release.pfx'), 'test fixture')
  assert.throws(
    () => resolveWindowsSigningOptions(baseConfig, root, {
      MURASAKI_WINDOWS_CERTIFICATE_FILE: 'release.pfx',
      MURASAKI_WINDOWS_CERTIFICATE_SUBJECT: 'Example Publisher',
    }),
    /choose exactly one Windows signing source/,
  )
})

test('untrusted certificate verification is narrowly restricted to CI PFX fixtures', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-signing-ci-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'release.pfx'), 'test fixture')

  assert.throws(
    () => resolveWindowsSigningOptions(baseConfig, root, {
      MURASAKI_WINDOWS_CERTIFICATE_FILE: 'release.pfx',
      MURASAKI_WINDOWS_CI_ALLOW_UNTRUSTED_CERTIFICATE: '1',
    }),
    /restricted to CI/,
  )
  assert.throws(
    () => resolveWindowsSigningOptions(baseConfig, root, {
      CI: 'true',
      MURASAKI_WINDOWS_CI_ALLOW_UNTRUSTED_CERTIFICATE: '1',
    }),
    /requires MURASAKI_WINDOWS_CERTIFICATE_FILE/,
  )

  const options = resolveWindowsSigningOptions(baseConfig, root, {
    CI: 'true',
    MURASAKI_WINDOWS_CERTIFICATE_FILE: 'release.pfx',
    MURASAKI_WINDOWS_CI_ALLOW_UNTRUSTED_CERTIFICATE: '1',
  })
  assert.equal(options.allowUntrustedCiCertificate, true)
  assert.equal(options.certificateFile, join(root, 'release.pfx'))
})
