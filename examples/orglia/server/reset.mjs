import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword, readSecret } from './auth.mjs'
import { executeCommand } from './commands.mjs'
import { accountsFor, bootstrapData, tenantIds } from './sample-data.mjs'
import { openStore } from './storage.mjs'

export async function resetTenant({ tenantId, withSample = true, store: providedStore } = {}) {
  if (!tenantId || !tenantIds.includes(tenantId)) throw new Error(`--tenant is required (${tenantIds.join(', ')})`)
  const store = providedStore ?? await openStore()
  try {
    const base = bootstrapData(tenantId, withSample)
    const password = await readSecret('ORGLIA_BOOTSTRAP_PASSWORD', { developmentFallback: 'orglia-demo-change-me' })
    await store.initializeTenant(tenantId, base, accountsFor(base), await hashPassword(password))
    const current = await store.read(tenantId)
    const admin = base.users[0]
    const result = await store.mutate(tenantId, current.revision, { userId: admin.id, name: 'Orglia CLI' }, (data) => executeCommand(data, { type: 'admin.reset', payload: { sample: withSample } }, { tenantId, userId: admin.id, role: 'admin', name: 'Orglia CLI' }, { resetData: (sample) => bootstrapData(tenantId, sample) }))
    return { engine: store.kind, sample: withSample, tenantId, revision: result.revision }
  } finally { if (!providedStore) await store.close() }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const tenantIndex = process.argv.indexOf('--tenant')
  const tenantId = tenantIndex >= 0 ? process.argv[tenantIndex + 1] : ''
  const result = await resetTenant({ tenantId, withSample: !process.argv.includes('--no-sample-data') })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
