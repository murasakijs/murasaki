import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { hashPassword } from './auth.mjs'
import { executeCommand } from './commands.mjs'
import { accountsFor, bootstrapData } from './sample-data.mjs'
import { openStore, RevisionConflictError } from './storage.mjs'

test('PostgreSQL transaction enforces revision concurrency and appends audit', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const store = await openStore({ databaseUrl: process.env.TEST_DATABASE_URL })
  const suffix = randomUUID().slice(0, 8); const tenantId = `pg-${suffix}`
  try {
    const data = bootstrapData('tn-kanto', true)
    data.tenants = data.tenants.map((item) => ({ ...item, id: tenantId }))
    for (const field of ['users', 'customers', 'opportunities', 'orders', 'inventory', 'projects', 'approvals', 'shifts', 'incidents']) for (const item of data[field]) item.tenantId = tenantId
    for (const user of data.users) user.email = `${suffix}-${user.email}`
    await store.initializeTenant(tenantId, data, accountsFor(data), await hashPassword('postgres-test'))
    const current = await store.read(tenantId); const actor = { tenantId, userId: 'usr-ops', role: 'operations', name: 'Postgres Ops' }
    const write = () => store.mutate(tenantId, current.revision, actor, (state) => executeCommand(state, { type: 'inventory.receive', payload: { sku: 'SRV-BASE-001', quantity: 1 } }, actor))
    const results = await Promise.allSettled([write(), write()])
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
    assert.ok(results.some((item) => item.status === 'rejected' && item.reason instanceof RevisionConflictError))
    const audit = await store.readAudit(tenantId)
    assert.equal(audit.length, 1); assert.equal(audit[0].action, 'inventory.received'); assert.ok(audit[0].hash)
  } finally { await store.close() }
})
