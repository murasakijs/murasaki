import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { downloadHttpsFile, fetchHttpsBytes, sha256File } from '../dist/cli/secure-fetch.js'

function withFetch(t, implementation) {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  t.after(() => { globalThis.fetch = original })
}

test('secure fetch rejects credentialed or non-HTTPS sources before network access', async (t) => {
  let called = false
  withFetch(t, async () => {
    called = true
    return new Response('unexpected')
  })
  const options = { label: 'fixture', maxBytes: 10, timeoutMs: 1_000 }

  await assert.rejects(fetchHttpsBytes('http://example.com/file', options), /credential-free HTTPS/)
  await assert.rejects(fetchHttpsBytes('https://user@example.com/file', options), /credential-free HTTPS/)
  assert.equal(called, false)
})

test('secure fetch rejects a redirect target with embedded credentials', async (t) => {
  const response = new Response('unexpected')
  Object.defineProperty(response, 'url', { value: 'https://user@example.com/final' })
  withFetch(t, async () => response)

  await assert.rejects(
    fetchHttpsBytes('https://example.com/start', {
      label: 'redirect fixture',
      maxBytes: 64,
      timeoutMs: 1_000,
    }),
    /redirected away from credential-free HTTPS/,
  )
})

test('secure fetch enforces declared and streamed byte limits', async (t) => {
  const responses = [
    new Response('small', { headers: { 'content-length': '999' } }),
    new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6))
        controller.enqueue(new Uint8Array(6))
        controller.close()
      },
    })),
  ]
  withFetch(t, async () => responses.shift())
  const options = { label: 'bounded fixture', maxBytes: 10, timeoutMs: 1_000 }

  await assert.rejects(fetchHttpsBytes('https://example.com/declared', options), /10-byte limit/)
  await assert.rejects(fetchHttpsBytes('https://example.com/streamed', options), /10-byte limit/)
})

test('secure download streams to a private file, hashes it, and removes partial failures', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-secure-fetch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const payload = Buffer.from('verified runtime')
  const responses = [
    new Response(payload),
    new Response(Buffer.alloc(12)),
  ]
  withFetch(t, async () => responses.shift())

  const path = join(root, 'runtime')
  const digest = await downloadHttpsFile('https://example.com/runtime', path, {
    label: 'runtime',
    maxBytes: 64,
    timeoutMs: 1_000,
  })
  assert.equal(digest, createHash('sha256').update(payload).digest('hex'))
  assert.deepEqual(await readFile(path), payload)
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600)
  }

  const partial = join(root, 'partial')
  await assert.rejects(
    downloadHttpsFile('https://example.com/oversized', partial, {
      label: 'oversized runtime',
      maxBytes: 10,
      timeoutMs: 1_000,
    }),
    /10-byte limit/,
  )
  assert.equal(existsSync(partial), false)
})

test('local artifact hashing matches SHA-256 without a whole-file API', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-local-hash-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const payload = Buffer.alloc(2 * 1024 * 1024 + 17, 0x5a)
  const path = join(root, 'artifact.bin')
  await writeFile(path, payload)

  assert.equal(await sha256File(path), createHash('sha256').update(payload).digest('hex'))
})

test('secure download never removes a pre-existing destination', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-secure-fetch-existing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'owned-by-caller')
  await writeFile(path, 'keep me')
  let fetched = false
  withFetch(t, async () => {
    fetched = true
    return new Response('replacement')
  })

  await assert.rejects(
    downloadHttpsFile('https://example.com/replacement', path, {
      label: 'replacement',
      maxBytes: 64,
      timeoutMs: 1_000,
    }),
    (error) => error?.code === 'EEXIST',
  )
  assert.equal(await readFile(path, 'utf8'), 'keep me')
  assert.equal(fetched, false)
})
