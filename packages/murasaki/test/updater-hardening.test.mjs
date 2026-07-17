import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createUpdaterEngine } from '../dist/runtime/updater.js'

function signingKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return { privateKey, publicKey: spki.subarray(spki.length - 32).toString('base64') }
}

function signedManifest(privateKey, manifest) {
  const bytes = Buffer.from(JSON.stringify(manifest))
  return { bytes, signature: sign(null, bytes, privateKey).toString('base64') }
}

function updaterConfig(manifestUrl, publicKey, overrides = {}) {
  return {
    manifestUrl,
    publicKey,
    publicKeys: [publicKey],
    maxManifestAgeDays: 90,
    channel: 'stable',
    checkOnStart: false,
    checkIntervalMs: false,
    ...overrides,
  }
}

/** Mirrors the client's `keyId` calculation (`runtime/updater.ts`'s `computeKeyId`) for building test fixtures. */
function keyIdFor(publicKeyB64) {
  return createHash('sha256').update(Buffer.from(publicKeyB64, 'base64')).digest('hex').slice(0, 16)
}

/**
 * Serves a signed `manifestObj` over a throwaway loopback HTTP server and
 * runs `check()` against it. `configOverrides` merge into the resolved
 * updater config (e.g. `publicKeys`); `engineOverrides` merge into the
 * top-level engine options (e.g. `resourcesDir`/`stagingDir`).
 */
async function checkManifest(t, privateKey, manifestObj, publicKey, { configOverrides = {}, engineOverrides = {} } = {}) {
  const { bytes, signature } = signedManifest(privateKey, manifestObj)
  const origin = await listen(t, (req, res) => {
    if (req.url === '/latest.json') return res.end(bytes)
    if (req.url === '/latest.json.sig') return res.end(signature)
    res.writeHead(404).end()
  })
  const engine = createUpdaterEngine({
    resolvedUpdater: updaterConfig(`${origin}/latest.json`, publicKey, configOverrides),
    currentVersion: '1.0.0',
    mode: 'prod',
    ...engineOverrides,
  })
  return engine.check()
}

async function listen(t, handler) {
  const server = createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  })
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function temporaryDirectories(t) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-updater-test-'))
  const stagingDir = join(root, 'staging')
  const resourcesDir = join(root, 'resources')
  await Promise.all([mkdir(stagingDir), mkdir(resourcesDir)])
  t.after(() => rm(root, { recursive: true, force: true }))
  return { stagingDir, resourcesDir }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

test('check and download are single-flight and install writes a private atomic handoff', async (t) => {
  const { privateKey, publicKey } = signingKey()
  const payload = Buffer.from('verified update payload')
  const gates = {}
  gates.manifest = deferred()
  gates.payload = deferred()
  const requests = { manifest: 0, signature: 0, payload: 0 }
  let manifestBytes
  let signature

  const origin = await listen(t, async (req, res) => {
    if (req.url === '/latest.json') {
      requests.manifest++
      await gates.manifest.promise
      res.end(manifestBytes)
      return
    }
    if (req.url === '/latest.json.sig') {
      requests.signature++
      res.end(signature)
      return
    }
    if (req.url === '/payload.zip') {
      requests.payload++
      await gates.payload.promise
      res.setHeader('content-length', payload.length)
      res.end(payload)
      return
    }
    res.writeHead(404).end()
  })
  ;({ bytes: manifestBytes, signature } = signedManifest(privateKey, {
    version: '2.0.0',
    assets: {
      [`${process.platform}-${process.arch}`]: {
        url: `${origin}/payload.zip`,
        sha256: createHash('sha256').update(payload).digest('hex'),
      },
    },
  }))

  const { stagingDir, resourcesDir } = await temporaryDirectories(t)
  const engine = createUpdaterEngine({
    resolvedUpdater: updaterConfig(`${origin}/latest.json`, publicKey),
    currentVersion: '1.0.0',
    mode: 'prod',
    stagingDir,
    resourcesDir,
  })

  const firstCheck = engine.check()
  const secondCheck = engine.check()
  assert.strictEqual(firstCheck, secondCheck)
  gates.manifest.resolve()
  assert.equal((await firstCheck).status, 'available')
  assert.deepEqual(requests, { manifest: 1, signature: 1, payload: 0 })

  const firstDownload = engine.download()
  const secondDownload = engine.download()
  assert.strictEqual(firstDownload, secondDownload)
  gates.payload.resolve()
  await firstDownload
  assert.equal(engine.getState().status, 'ready')
  assert.equal(requests.payload, 1)

  const sessions = await readdir(stagingDir)
  assert.equal(sessions.length, 1)
  assert.match(sessions[0], /-2\.0\.0-/)
  assert.deepEqual(await readFile(join(stagingDir, sessions[0], 'payload.zip')), payload)

  assert.deepEqual(await engine.install(), { ok: true })
  const handoffPath = join(resourcesDir, '.murasaki-apply.json')
  const handoff = JSON.parse(await readFile(handoffPath, 'utf8'))
  assert.equal(handoff.sha256, createHash('sha256').update(payload).digest('hex'))
  assert.equal(handoff.payload, join(stagingDir, sessions[0], 'payload.zip'))
  if (process.platform !== 'win32') {
    assert.equal((await stat(handoffPath)).mode & 0o777, 0o600)
  }
  assert.deepEqual((await readdir(resourcesDir)).filter((name) => name.endsWith('.tmp')), [])
})

test('rejects oversized manifest and signature responses', async (t) => {
  const { privateKey, publicKey } = signingKey()
  let validManifest
  const origin = await listen(t, (req, res) => {
    if (req.url === '/large.json') {
      res.end(Buffer.alloc(65, 0x20))
      return
    }
    if (req.url === '/signature.json') {
      res.end(validManifest)
      return
    }
    if (req.url === '/signature.json.sig') {
      res.end('x'.repeat(65))
      return
    }
    res.writeHead(404).end()
  })
  validManifest = signedManifest(privateKey, { version: '2.0.0', assets: {} }).bytes

  const manifestEngine = createUpdaterEngine({
    resolvedUpdater: updaterConfig(`${origin}/large.json`, publicKey),
    currentVersion: '1.0.0',
    mode: 'prod',
    maxManifestBytes: 64,
  })
  assert.match((await manifestEngine.check()).error ?? '', /manifest exceeds the 64-byte size limit/)

  const signatureEngine = createUpdaterEngine({
    resolvedUpdater: updaterConfig(`${origin}/signature.json`, publicKey),
    currentVersion: '1.0.0',
    mode: 'prod',
    maxSignatureBytes: 64,
  })
  assert.match(
    (await signatureEngine.check()).error ?? '',
    /manifest signature exceeds the 64-byte size limit/,
  )
})

test('rejects oversized payloads and removes the failed staging session', async (t) => {
  const { privateKey, publicKey } = signingKey()
  const payload = Buffer.from('five!')
  let manifestBytes
  let signature
  const origin = await listen(t, (req, res) => {
    if (req.url === '/latest.json') return res.end(manifestBytes)
    if (req.url === '/latest.json.sig') return res.end(signature)
    if (req.url === '/payload.zip') {
      // Chunked on purpose: the limit must still hold when an endpoint omits
      // content-length rather than only trusting the early header check.
      res.write(payload.subarray(0, 2))
      return res.end(payload.subarray(2))
    }
    res.writeHead(404).end()
  })
  ;({ bytes: manifestBytes, signature } = signedManifest(privateKey, {
    version: '2.0.0',
    assets: {
      [`${process.platform}-${process.arch}`]: {
        url: `${origin}/payload.zip`,
        sha256: createHash('sha256').update(payload).digest('hex'),
      },
    },
  }))
  const { stagingDir } = await temporaryDirectories(t)
  const engine = createUpdaterEngine({
    resolvedUpdater: updaterConfig(`${origin}/latest.json`, publicKey),
    currentVersion: '1.0.0',
    mode: 'prod',
    stagingDir,
    maxPayloadBytes: payload.length - 1,
  })

  assert.equal((await engine.check()).status, 'available')
  await engine.download()
  assert.match(engine.getState().error ?? '', /update payload exceeds the 4-byte size limit/)
  assert.deepEqual(await readdir(stagingDir), [])
})

test('aborts stalled metadata and payload fetches at their configured deadlines', async (t) => {
  const { privateKey, publicKey } = signingKey()
  let manifestBytes
  let signature
  const origin = await listen(t, (req, res) => {
    if (req.url === '/slow.json') {
      setTimeout(() => res.end('{}'), 200).unref()
      return
    }
    if (req.url === '/latest.json') return res.end(manifestBytes)
    if (req.url === '/latest.json.sig') return res.end(signature)
    if (req.url === '/slow-payload.zip') {
      setTimeout(() => res.end('payload'), 200).unref()
      return
    }
    res.writeHead(404).end()
  })
  ;({ bytes: manifestBytes, signature } = signedManifest(privateKey, {
    version: '2.0.0',
    assets: {
      [`${process.platform}-${process.arch}`]: {
        url: `${origin}/slow-payload.zip`,
        sha256: createHash('sha256').update('payload').digest('hex'),
      },
    },
  }))

  const metadataEngine = createUpdaterEngine({
    resolvedUpdater: updaterConfig(`${origin}/slow.json`, publicKey),
    currentVersion: '1.0.0',
    mode: 'prod',
    requestTimeoutMs: 25,
  })
  assert.match((await metadataEngine.check()).error ?? '', /manifest request timed out after 25ms/)

  const { stagingDir } = await temporaryDirectories(t)
  const payloadEngine = createUpdaterEngine({
    resolvedUpdater: updaterConfig(`${origin}/latest.json`, publicKey),
    currentVersion: '1.0.0',
    mode: 'prod',
    stagingDir,
    downloadTimeoutMs: 25,
  })
  assert.equal((await payloadEngine.check()).status, 'available')
  await payloadEngine.download()
  assert.match(payloadEngine.getState().error ?? '', /update payload request timed out after 25ms/)
  assert.deepEqual(await readdir(stagingDir), [])
})

test('TLS: rejects a non-loopback http manifestUrl but allows loopback http', async (t) => {
  const { privateKey, publicKey } = signingKey()

  const insecureEngine = createUpdaterEngine({
    resolvedUpdater: updaterConfig('http://updates.example.com/latest.json', publicKey),
    currentVersion: '1.0.0',
    mode: 'prod',
  })
  const insecureState = await insecureEngine.check()
  assert.equal(insecureState.status, 'error')
  assert.match(insecureState.error, /manifestUrl must use https/)

  // Loopback http (127.0.0.1) is exercised by every other test in this file
  // via `listen()`. Confirm `localhost` is accepted too.
  const { bytes, signature } = signedManifest(privateKey, { version: '0.1.0', assets: {} })
  const origin = await listen(t, (req, res) => {
    if (req.url === '/latest.json') return res.end(bytes)
    if (req.url === '/latest.json.sig') return res.end(signature)
    res.writeHead(404).end()
  })
  const loopbackUrl = origin.replace('127.0.0.1', 'localhost')
  const loopbackEngine = createUpdaterEngine({
    resolvedUpdater: updaterConfig(`${loopbackUrl}/latest.json`, publicKey),
    currentVersion: '1.0.0',
    mode: 'prod',
  })
  const loopbackState = await loopbackEngine.check()
  assert.equal(loopbackState.status, 'not-available') // 0.1.0 <= currentVersion 1.0.0 — not a TLS error
})

test('manifest freshness rejects a stale manifest and one too far in the future, warns when generatedAt is absent', async (t) => {
  const { privateKey, publicKey } = signingKey()
  const asset = {
    [`${process.platform}-${process.arch}`]: { url: 'http://unused.invalid/payload', sha256: 'a'.repeat(64) },
  }

  const stale = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
  const staleState = await checkManifest(t, privateKey, { version: '2.0.0', generatedAt: stale, assets: asset }, publicKey)
  assert.equal(staleState.status, 'error')
  assert.match(staleState.error, /freshness limit/)

  const tooFarFuture = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const futureState = await checkManifest(
    t,
    privateKey,
    { version: '2.0.0', generatedAt: tooFarFuture, assets: asset },
    publicKey,
  )
  assert.equal(futureState.status, 'error')
  assert.match(futureState.error, /clock skew or tampering/)

  // within the 24h clock-skew tolerance -> accepted
  const withinSkew = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const skewState = await checkManifest(
    t,
    privateKey,
    { version: '2.0.0', generatedAt: withinSkew, assets: asset },
    publicKey,
  )
  assert.equal(skewState.status, 'available')

  // absent generatedAt -> still accepted (back-compat), but logs a structured warning
  const originalWarn = console.warn
  const warnLines = []
  console.warn = (line) => warnLines.push(line)
  let absentState
  try {
    absentState = await checkManifest(t, privateKey, { version: '2.0.0', assets: asset }, publicKey)
  } finally {
    console.warn = originalWarn
  }
  assert.equal(absentState.status, 'available')
  assert.ok(warnLines.some((line) => line.includes('updater.manifest.generated_at_missing')))
})

test('multi-key verification tries every pinned key; a keyId hint is only ever an optimization', async (t) => {
  const keyA = signingKey()
  const keyB = signingKey()
  const keyC = signingKey() // never pinned
  const asset = {
    [`${process.platform}-${process.arch}`]: { url: 'http://unused.invalid/payload', sha256: 'a'.repeat(64) },
  }
  const pinned = { publicKeys: [keyA.publicKey, keyB.publicKey] }
  const generatedAt = new Date().toISOString()

  // Signed with the second pinned key, no hint at all -> falls back and succeeds.
  let state = await checkManifest(
    t,
    keyB.privateKey,
    { version: '2.0.0', generatedAt, assets: asset },
    keyA.publicKey,
    { configOverrides: pinned },
  )
  assert.equal(state.status, 'available')

  // Signed with the second pinned key, correct hint for it -> succeeds.
  state = await checkManifest(
    t,
    keyB.privateKey,
    { version: '2.0.0', generatedAt, keyId: keyIdFor(keyB.publicKey), assets: asset },
    keyA.publicKey,
    { configOverrides: pinned },
  )
  assert.equal(state.status, 'available')

  // Signed with the second pinned key, but the hint points at an unpinned
  // key -- must still fall back through every pinned key and succeed.
  state = await checkManifest(
    t,
    keyB.privateKey,
    { version: '2.0.0', generatedAt, keyId: keyIdFor(keyC.publicKey), assets: asset },
    keyA.publicKey,
    { configOverrides: pinned },
  )
  assert.equal(state.status, 'available')

  // Signed with a key that isn't pinned at all -> rejected.
  state = await checkManifest(
    t,
    keyC.privateKey,
    { version: '2.0.0', generatedAt, assets: asset },
    keyA.publicKey,
    { configOverrides: pinned },
  )
  assert.equal(state.status, 'error')
  assert.match(state.error, /signature verification failed/)
})

test('staged rollout buckets deterministically from a persisted client id and gates without erroring', async (t) => {
  const { privateKey, publicKey } = signingKey()
  const { stagingDir, resourcesDir } = await temporaryDirectories(t)
  const clientId = '11111111-1111-4111-8111-111111111111'
  await writeFile(join(resourcesDir, 'update-client-id'), clientId)
  const bucket = createHash('sha256').update(clientId).digest()[0] % 100

  const asset = {
    [`${process.platform}-${process.arch}`]: { url: 'http://unused.invalid/payload', sha256: 'a'.repeat(64) },
  }
  const generatedAt = new Date().toISOString()
  const engineOverrides = { resourcesDir, stagingDir }

  // rollout strictly above this client's bucket -> available
  const includedState = await checkManifest(
    t,
    privateKey,
    { version: '2.0.0', generatedAt, rollout: Math.min(100, bucket + 1), assets: asset },
    publicKey,
    { engineOverrides },
  )
  assert.equal(includedState.status, 'available')

  // rollout at or below the bucket -> not-available, never an error
  const excludedState = await checkManifest(
    t,
    privateKey,
    { version: '2.0.0', generatedAt, rollout: bucket, assets: asset },
    publicKey,
    { engineOverrides },
  )
  assert.equal(excludedState.status, 'not-available')
  assert.equal(excludedState.error, undefined)

  // the persisted client id is reused across checks, not regenerated
  assert.equal((await readFile(join(resourcesDir, 'update-client-id'), 'utf8')).trim(), clientId)

  // absent rollout (100%) -> always available regardless of bucket
  const noRolloutState = await checkManifest(
    t,
    privateKey,
    { version: '2.0.1', generatedAt, assets: asset },
    publicKey,
    { engineOverrides },
  )
  assert.equal(noRolloutState.status, 'available')
})

test('win32-arm64 resolves as a platform key like any other platform-arch combination', async (t) => {
  const { privateKey, publicKey } = signingKey()
  const asset = {
    'win32-arm64': { url: 'http://unused.invalid/payload', sha256: 'a'.repeat(64) },
  }
  const generatedAt = new Date().toISOString()

  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true })
  t.after(() => {
    Object.defineProperty(process, 'platform', originalPlatform)
    Object.defineProperty(process, 'arch', originalArch)
  })

  const state = await checkManifest(t, privateKey, { version: '2.0.0', generatedAt, assets: asset }, publicKey)
  assert.equal(state.status, 'available')
  assert.equal(state.latest, '2.0.0')
})
