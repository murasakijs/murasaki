import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const runtime = await jiti.import('../src/backend/runtime.ts')
const store = await jiti.import('../src/backend/store.ts')

test('empty-session storage never overwrites the primary workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'papelle-store-'))
  try {
    runtime.configureRuntime(root, false)
    const primary = store.resetStoredWorkspace(false)
    primary.pages.push({ id: 'kept', parentId: null, title: 'Keep me', icon: '◇', tags: [], blocks: [], favorite: false, sample: false, updatedAt: new Date().toISOString() })
    primary.selectedPageId = 'kept'
    store.writeWorkspace(primary)

    const empty = store.readWorkspace(true)
    assert.equal(empty.workspace.pages.length, 0)
    store.writeWorkspace(empty.workspace)

    runtime.selectWorkspaceSlot(false)
    const restoredPrimary = store.readWorkspace().workspace
    assert.equal(restoredPrimary.pages[0].title, 'Keep me')
    restoredPrimary.trash.push({ id: 'trashed-child', parentId: 'kept', title: 'Trashed child', icon: '◇', tags: [], blocks: [], favorite: false, sample: false, updatedAt: new Date().toISOString() })
    store.writeWorkspace(restoredPrimary)
    assert.equal(store.readWorkspace().workspace.trash[0].parentId, 'kept')
  } finally {
    store.closeStore()
    await rm(root, { recursive: true, force: true })
  }
})

test('corrupt workspace rows are quarantined before an empty recovery workspace is returned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'papelle-recovery-'))
  try {
    runtime.configureRuntime(root, false)
    store.readWorkspace()
    store.closeStore()
    const database = new DatabaseSync(join(root, 'papelle.db'))
    database.prepare('UPDATE workspace_state SET payload = ? WHERE id = ?').run('{broken-json', 'primary')
    database.close()
    const recovered = store.readWorkspace()
    assert.equal(recovered.recoveryAvailable, true)
    assert.equal(recovered.workspace.pages.length, 0)
    assert.equal(store.readLatestQuarantine().payload, '{broken-json')
    store.writeWorkspace(recovered.workspace)
    assert.equal(store.readWorkspace().recoveryAvailable, true)
  } finally {
    store.closeStore()
    await rm(root, { recursive: true, force: true })
  }
})

test('nested malformed workspace data is quarantined instead of normalized into active state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'papelle-nested-recovery-'))
  try {
    runtime.configureRuntime(root, false)
    const workspace = store.resetStoredWorkspace(false)
    store.closeStore()
    const database = new DatabaseSync(join(root, 'papelle.db'))
    database.prepare('UPDATE workspace_state SET payload = ? WHERE id = ?').run(JSON.stringify({
      ...workspace,
      pages: [{ id: 'unsafe', parentId: null, title: 'Unsafe', icon: '◇', tags: 'not-an-array', blocks: [], favorite: false, updatedAt: new Date().toISOString() }],
    }), 'primary')
    database.close()

    const recovered = store.readWorkspace()
    assert.equal(recovered.recoveryAvailable, true)
    assert.equal(recovered.workspace.pages.length, 0)
    assert.match(store.readLatestQuarantine().payload, /not-an-array/)
  } finally {
    store.closeStore()
    await rm(root, { recursive: true, force: true })
  }
})
