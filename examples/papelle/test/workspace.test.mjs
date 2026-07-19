import assert from 'node:assert/strict'
import test from 'node:test'
import { backlinksForPage, createEmptyWorkspace, createSampleWorkspace, markdownFromPage, mergeWorkspaces, normalizeWorkspace, pageFromMarkdown, restoreTrashedPages, searchWorkspace, trashPageTree } from '../src/domain/workspace.js'

test('sample workspace is explicitly marked and empty launch contains no pages', () => {
  const sample = createSampleWorkspace('en')
  assert.equal(sample.sampleData, true)
  assert.ok(sample.pages.length >= 3)
  assert.deepEqual(createEmptyWorkspace('ja').pages, [])
})

test('legacy workspaces normalize revision, trash and per-record sample provenance', () => {
  const legacy = createSampleWorkspace('en')
  delete legacy.revision
  delete legacy.trash
  for (const page of legacy.pages) delete page.sample
  const normalized = normalizeWorkspace(legacy)
  assert.equal(normalized.revision, 0)
  assert.deepEqual(normalized.trash, [])
  assert.ok(normalized.pages.every((page) => page.sample))
})

test('three-way merge preserves independent edits and converges on same-field conflicts', () => {
  const base = createSampleWorkspace('en')
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.pages[0].title = 'Local title'
  local.pages[0].updatedAt = '2026-07-19T10:00:00.000Z'
  remote.pages[0].blocks[0].text = 'Remote paragraph'
  remote.pages[0].blocks[0].updatedAt = '2026-07-19T11:00:00.000Z'
  remote.pages[0].updatedAt = '2026-07-19T11:00:00.000Z'
  const merged = mergeWorkspaces(base, local, remote)
  assert.equal(merged.pages[0].title, 'Local title')
  assert.equal(merged.pages[0].blocks[0].text, 'Remote paragraph')

  local.locale = 'ja'
  remote.locale = 'en'
  assert.deepEqual(mergeWorkspaces(base, local, remote), mergeWorkspaces(base, remote, local))
})

test('trashing a page recursively moves every descendant and restore is lossless', () => {
  const workspace = createSampleWorkspace('en')
  workspace.pages.push({ id: 'deep', parentId: 'research', title: 'Deep', icon: '◇', tags: [], favorite: false, sample: false, updatedAt: new Date().toISOString(), blocks: [] })
  const trashed = trashPageTree(workspace, 'work')
  assert.deepEqual(new Set(trashed.trash.map((page) => page.id)), new Set(['work', 'project-atlas', 'research', 'offline-first', 'deep']))
  assert.ok(!trashed.pages.some((page) => page.parentId === 'work'))
  const restored = restoreTrashedPages(trashed)
  assert.equal(restored.trash.length, 0)
  assert.deepEqual(new Set(restored.pages.map((page) => page.id)), new Set(workspace.pages.map((page) => page.id)))

  const withExistingTrash = trashPageTree(workspace, 'personal')
  const secondDelete = trashPageTree(withExistingTrash, 'research')
  const undoSecondOnly = restoreTrashedPages(secondDelete, ['research', 'offline-first', 'deep'])
  assert.ok(undoSecondOnly.trash.some((page) => page.id === 'personal'))
  assert.equal(undoSecondOnly.pages.find((page) => page.id === 'research')?.parentId, 'work')
})

test('Markdown round-trip retains title, headings, callouts and tasks', () => {
  const source = '# Field notes\n\n## Goals\n\n- [x] Ship local persistence\n\n> Keep ownership clear.\n'
  const page = pageFromMarkdown(source, 'field-notes')
  assert.equal(page.title, 'Field notes')
  assert.equal(page.blocks.find((block) => block.type === 'check')?.checked, true)
  const result = markdownFromPage(page)
  assert.match(result, /^# Field notes/m)
  assert.match(result, /- \[x\] Ship local persistence/)
  assert.match(result, /> Keep ownership clear\./)
})

test('search indexes titles, tags and block text and backlinks resolve wiki links', () => {
  const workspace = createSampleWorkspace('en')
  assert.ok(searchWorkspace(workspace, 'offline').some((page) => page.id === 'offline-first'))
  const atlas = workspace.pages.find((page) => page.id === 'project-atlas')
  assert.ok(atlas)
  assert.ok(backlinksForPage(workspace, atlas).some((page) => page.id === 'offline-first'))
})
