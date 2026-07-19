import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hashPassword } from './auth.mjs'
import { executeCommand } from './commands.mjs'
import { accountsFor, bootstrapData } from './sample-data.mjs'
import { openStore, RevisionConflictError } from './storage.mjs'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'orglia-store-'))
  const store = await openStore({ sqlitePath: join(directory, 'orglia.db') })
  const passwordHash = await hashPassword('test-password')
  for (const tenantId of ['tn-kanto', 'tn-kansai']) {
    const data = bootstrapData(tenantId, true)
    await store.initializeTenant(tenantId, data, accountsFor(data), passwordHash)
  }
  return { store, async close() { await store.close(); await rm(directory, { recursive: true, force: true }) } }
}

test('tenant state and append-only audit stay isolated', async () => {
  const context = await fixture()
  try {
    const east = await context.store.read('tn-kanto'); const westBefore = await context.store.read('tn-kansai')
    const actor = { tenantId: 'tn-kanto', userId: 'usr-ops', role: 'operations', name: 'Test Ops' }
    await context.store.mutate('tn-kanto', east.revision, actor, (data) => executeCommand(data, { type: 'inventory.receive', payload: { sku: 'SRV-BASE-001', quantity: 2 } }, actor))
    const westAfter = await context.store.read('tn-kansai'); const audit = await context.store.readAudit('tn-kanto')
    assert.deepEqual(westAfter, westBefore)
    assert.equal(audit.length, 1)
    assert.equal(audit[0].action, 'inventory.received')
    assert.ok(audit[0].hash)
    assert.deepEqual(audit[0].before.onHand, 3)
    assert.deepEqual(audit[0].after.onHand, 5)
  } finally { await context.close() }
})

test('optimistic revision permits exactly one concurrent writer', async () => {
  const context = await fixture()
  try {
    const current = await context.store.read('tn-kanto')
    const actor = { tenantId: 'tn-kanto', userId: 'usr-ops', role: 'operations', name: 'Test Ops' }
    const write = () => context.store.mutate('tn-kanto', current.revision, actor, (data) => executeCommand(data, { type: 'inventory.receive', payload: { sku: 'SRV-BASE-001', quantity: 1 } }, actor))
    const results = await Promise.allSettled([write(), write()])
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
    const rejected = results.find((item) => item.status === 'rejected')
    assert.ok(rejected.reason instanceof RevisionConflictError)
  } finally { await context.close() }
})

test('inventory commands reject non-finite and overflowing quantities without mutating state', async () => {
  const context = await fixture()
  try {
    const current = await context.store.read('tn-kanto')
    const actor = { tenantId: 'tn-kanto', userId: 'usr-ops', role: 'operations', name: 'Test Ops' }
    for (const quantity of [Number.MAX_VALUE, 1_000_000_001, 1.5, '2']) {
      const candidate = structuredClone(current.data)
      assert.throws(
        () => executeCommand(candidate, { type: 'inventory.receive', payload: { sku: 'SRV-BASE-001', quantity } }, actor),
        (error) => error instanceof Error && ['INVALID_INPUT', 'INVENTORY_LIMIT'].includes(error.code),
      )
      assert.equal(candidate.inventory.find((item) => item.sku === 'SRV-BASE-001').onHand, 3)
    }
  } finally { await context.close() }
})

test('server approval policy validates current step role and records before/after', async () => {
  const context = await fixture()
  try {
    const current = await context.store.read('tn-kanto')
    const wrongRole = { tenantId: 'tn-kanto', userId: 'usr-sales', role: 'sales', name: 'Sales' }
    assert.throws(() => executeCommand(structuredClone(current.data), { type: 'approval.decide', payload: { requestId: 'apr-72', decision: 'approve', comment: '' } }, wrongRole), /cannot perform/)
    const manager = { tenantId: 'tn-kanto', userId: 'usr-manager', role: 'manager', name: 'Manager' }
    await context.store.mutate('tn-kanto', current.revision, manager, (data) => executeCommand(data, { type: 'approval.decide', payload: { requestId: 'apr-72', decision: 'return', comment: 'Add vendor quotes' } }, manager))
    const audit = await context.store.readAudit('tn-kanto')
    assert.equal(audit[0].action, 'approval.returned')
    assert.equal(audit[0].before.status, 'pending')
    assert.equal(audit[0].after.status, 'returned')
  } finally { await context.close() }
})

test('tenant-scoped no-sample reset preserves another tenant and existing audit', async () => {
  const context = await fixture()
  try {
    const east = await context.store.read('tn-kanto'); const west = await context.store.read('tn-kansai')
    const admin = { tenantId: 'tn-kanto', userId: 'usr-admin', role: 'admin', name: 'Admin' }
    await context.store.mutate('tn-kanto', east.revision, admin, (data) => executeCommand(data, { type: 'admin.reset', payload: { sample: false } }, admin, { resetData: (sample) => bootstrapData('tn-kanto', sample) }))
    const reset = await context.store.read('tn-kanto'); const audit = await context.store.readAudit('tn-kanto')
    assert.equal(reset.data.sampleData, false)
    assert.equal(reset.data.orders.length, 0)
    assert.deepEqual(await context.store.read('tn-kansai'), west)
    assert.equal(audit[0].action, 'tenant.reset')
  } finally { await context.close() }
})

test('no-sample startup initializes an empty tenant but never replaces existing data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglia-nosample-'))
  const store = await openStore({ sqlitePath: join(directory, 'orglia.db') })
  try {
    const passwordHash = await hashPassword('test-password')
    const empty = bootstrapData('tn-kanto', false)
    await store.initializeTenant('tn-kanto', empty, accountsFor(empty), passwordHash)
    assert.equal((await store.read('tn-kanto')).data.orders.length, 0)
    const sample = bootstrapData('tn-kanto', true)
    await store.mutate('tn-kanto', 0, { userId: 'usr-admin', name: 'Test' }, () => ({ data: sample, events: [] }))
    await store.initializeTenant('tn-kanto', empty, accountsFor(empty), passwordHash)
    assert.equal((await store.read('tn-kanto')).data.sampleData, true)
    assert.ok((await store.read('tn-kanto')).data.orders.length > 0)
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }) }
})
