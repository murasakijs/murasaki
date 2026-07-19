import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_MESSAGE_BYTES, tokenMatches, validWorkspace } from '../server/src/protocol.mjs'
import { createSampleWorkspace } from '../src/domain/workspace.js'

test('room tokens use exact bounded comparison', () => {
  assert.equal(tokenMatches('0123456789abcdef', '0123456789abcdef'), true)
  assert.equal(tokenMatches('0123456789abcdeg', '0123456789abcdef'), false)
  assert.equal(tokenMatches('short', '0123456789abcdef'), false)
})

test('sync validation accepts normalized data and rejects malformed nested payloads', () => {
  assert.equal(validWorkspace(createSampleWorkspace('en')), true)
  const poisoned = createSampleWorkspace('en')
  poisoned.pages = [null]
  assert.equal(validWorkspace(poisoned), false)
  const oversized = createSampleWorkspace('en')
  oversized.pages[0].blocks[0].text = 'x'.repeat(200_001)
  assert.equal(validWorkspace(oversized), false)
  const orphaned = createSampleWorkspace('en')
  orphaned.pages.find((page) => page.id === 'research').parentId = 'missing-parent'
  assert.equal(validWorkspace(orphaned), false)
  const cyclic = createSampleWorkspace('en')
  cyclic.pages.find((page) => page.id === 'work').parentId = 'research'
  assert.equal(validWorkspace(cyclic), false)
  const trashFlood = createSampleWorkspace('en')
  trashFlood.trash = Array.from({ length: 11 }, (_, pageIndex) => ({
    id: `trash-${pageIndex}`, parentId: null, title: 'Trash', icon: 'T', tags: [],
    favorite: false, updatedAt: new Date().toISOString(),
    blocks: Array.from({ length: 2_000 }, (_, blockIndex) => ({
      id: `trash-${pageIndex}-block-${blockIndex}`, type: 'paragraph', text: 'x',
      updatedAt: new Date().toISOString(),
    })),
  }))
  assert.equal(validWorkspace(trashFlood), false)
  assert.equal(MAX_MESSAGE_BYTES, 24 * 1024 * 1024)
})
