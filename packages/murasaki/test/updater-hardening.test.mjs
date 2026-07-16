import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
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

function updaterConfig(manifestUrl, publicKey) {
  return {
    manifestUrl,
    publicKey,
    channel: 'stable',
    checkOnStart: false,
    checkIntervalMs: false,
  }
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
