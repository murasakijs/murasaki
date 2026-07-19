import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootstrapServer } from './server.mjs'
import { openStore } from './storage.mjs'

async function runningServer(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'orglia-api-'))
  const clientDir = join(directory, 'client')
  await mkdir(clientDir)
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>Orglia</title>')
  const store = await openStore({ sqlitePath: join(directory, 'orglia.db') })
  const app = await bootstrapServer({ store, bootstrapPassword: 'integration-password', withSample: true, clientDir, secureCookie: false, ...options })
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address(); const origin = `http://127.0.0.1:${address.port}`
  return { ...app, origin, directory, clientDir, async close() { await new Promise((resolve) => app.server.close(resolve)); await store.close(); await rm(directory, { recursive: true, force: true }) } }
}

async function login(origin, email, requestOrigin = origin) {
  const response = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-orglia-request': '1', origin: requestOrigin }, body: JSON.stringify({ email, password: 'integration-password' }) })
  assert.equal(response.status, 200)
  return { cookie: response.headers.get('set-cookie').split(';')[0], body: await response.json() }
}

test('authenticated API derives tenant and role from its HttpOnly session', async () => {
  const app = await runningServer()
  try {
    const viewer = await login(app.origin, 'viewer@kanto.orglia.local')
    assert.match(viewer.cookie, /^orglia_session=/)
    const forbidden = await fetch(`${app.origin}/api/commands`, { method: 'POST', headers: { cookie: viewer.cookie, origin: app.origin, 'content-type': 'application/json', 'x-orglia-request': '1' }, body: JSON.stringify({ revision: viewer.body.state.revision, type: 'inventory.receive', payload: { tenantId: 'tn-kansai', sku: 'POS-WEST-01', quantity: 999 } }) })
    assert.equal(forbidden.status, 403)
    const crossTenant = await fetch(`${app.origin}/api/state?tenantId=tn-kansai`, { headers: { cookie: viewer.cookie } })
    const projected = await crossTenant.json()
    assert.deepEqual(projected.data.tenants.map((item) => item.id), ['tn-kanto'])
    assert.ok(projected.data.orders.every((item) => item.tenantId === 'tn-kanto'))
    const legacyWrite = await fetch(`${app.origin}/api/state`, { method: 'PUT', headers: { cookie: viewer.cookie, origin: app.origin, 'content-type': 'application/json', 'x-orglia-request': '1' }, body: JSON.stringify({ audit: [] }) })
    assert.equal(legacyWrite.status, 404)
  } finally { await app.close() }
})

test('command revision conflicts return 409 and leave one append-only event', async () => {
  const app = await runningServer()
  try {
    const operations = await login(app.origin, 'operations@kanto.orglia.local')
    const request = () => fetch(`${app.origin}/api/commands`, { method: 'POST', headers: { cookie: operations.cookie, origin: app.origin, 'content-type': 'application/json', 'x-orglia-request': '1' }, body: JSON.stringify({ revision: operations.body.state.revision, type: 'inventory.receive', payload: { sku: 'SRV-BASE-001', quantity: 1 } }) })
    const responses = await Promise.all([request(), request()])
    assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409])
    const stateResponse = await fetch(`${app.origin}/api/state`, { headers: { cookie: operations.cookie } }); const state = await stateResponse.json()
    assert.equal(state.data.audit.filter((item) => item.action === 'inventory.received').length, 1)
  } finally { await app.close() }
})

test('static serving rejects symlinks escaping dist/client and malformed cookies fail closed', async () => {
  const app = await runningServer()
  try {
    const secret = join(app.directory, 'secret.txt')
    await writeFile(secret, 'must-not-be-served')
    await symlink(secret, join(app.clientDir, 'leak.txt'))
    const escaped = await fetch(`${app.origin}/leak.txt`)
    assert.equal(escaped.status, 403)
    assert.doesNotMatch(await escaped.text(), /must-not-be-served/)

    const malformed = await fetch(`${app.origin}/api/state`, {
      headers: { cookie: 'unrelated=%E0%A4%A; orglia_session=%E0%A4%A' },
    })
    assert.equal(malformed.status, 401)
  } finally { await app.close() }
})

test('explicit public origin supports TLS termination without trusting forwarded headers', async () => {
  const publicOrigin = 'https://orglia.example.test'
  const app = await runningServer({ publicOrigin })
  try {
    const session = await login(app.origin, 'viewer@kanto.orglia.local', publicOrigin)
    assert.equal(session.body.session.user.email, 'viewer@kanto.orglia.local')
    const spoofed = await fetch(`${app.origin}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-orglia-request': '1', origin: app.origin, 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ email: 'viewer@kanto.orglia.local', password: 'integration-password' }),
    })
    assert.equal(spoofed.status, 403)
  } finally { await app.close() }
})

test('login throttling does not lock unrelated accounts sharing one peer address', async () => {
  const app = await runningServer()
  try {
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await fetch(`${app.origin}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-orglia-request': '1', origin: app.origin },
        body: JSON.stringify({ email: 'viewer@kanto.orglia.local', password: 'wrong-password' }),
      })
      assert.equal(response.status, attempt < 8 ? 401 : 429)
    }
    const otherAccount = await login(app.origin, 'operations@kanto.orglia.local')
    assert.equal(otherAccount.body.session.user.email, 'operations@kanto.orglia.local')
  } finally { await app.close() }
})

test('declared oversized bodies are rejected before the stream is consumed', async () => {
  const app = await runningServer()
  try {
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(`${app.origin}/api/login`, {
        method: 'POST',
        headers: {
          'content-length': String(300 * 1024),
          'content-type': 'application/json',
          'x-orglia-request': '1',
          origin: app.origin,
        },
      }, (response) => { response.resume(); response.once('end', () => resolve(response.statusCode)) })
      request.once('error', reject)
      request.end()
    })
    assert.equal(status, 413)
  } finally { await app.close() }
})
