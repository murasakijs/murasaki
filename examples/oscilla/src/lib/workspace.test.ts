import assert from 'node:assert/strict'
import test from 'node:test'
import { parseImport } from './protocol.ts'
import { createWorkspace, hydrateWorkspace, mergeImport, normalizeWorkspace, sampleRequest, sampleScenario, supportsOscillaNode } from './workspace.ts'

test('enforces the first unflagged Node 22 sqlite runtime', () => {
  assert.equal(supportsOscillaNode('v22.12.0'), false)
  assert.equal(supportsOscillaNode('v22.13.0'), true)
  assert.equal(supportsOscillaNode('v23.1.0'), false)
  assert.equal(supportsOscillaNode('v24.0.0'), true)
})

test('creates an empty durable workspace with --no-sample-data semantics', () => {
  const workspace = createWorkspace('http://127.0.0.1:9000', false)
  assert.deepEqual(workspace.requests, [])
  assert.deepEqual(workspace.scenarios, [])
  assert.equal(workspace.environments[0]?.baseUrl, 'http://127.0.0.1:9000')
})

test('creates a sample scenario whose extracted variable is consumed downstream', () => {
  const workspace = createWorkspace('http://127.0.0.1:9000', true)
  const scenario = sampleScenario(workspace.requests[0]!, 'http://127.0.0.1:9000')
  assert.equal(scenario.steps[0]?.extract?.variable, 'telemetryId')
  assert.match(scenario.steps[1]?.request.url ?? '', /\{\{telemetryId\}\}/)
})

test('persists every imported request, variables, collection and source document', () => {
  const imported = parseImport(JSON.stringify({
    info: { name: 'Nested collection' }, variable: [{ key: 'host', value: 'http://localhost' }],
    item: [{ name: 'Folder', item: [
      { name: 'One', request: { method: 'GET', url: '{{host}}/one' } },
      { name: 'Two', request: { method: 'POST', url: '{{host}}/two', body: { raw: '{}' } } },
    ] }],
  }))
  const merged = mergeImport(createWorkspace('http://127.0.0.1:9000', false), imported, '{"source":true}', '2026-01-01T00:00:00.000Z')
  assert.equal(merged.requests.length, 2)
  assert.deepEqual(merged.collections[0]?.requestIds, merged.requests.map((request) => request.id))
  assert.equal(merged.variables.host, 'http://localhost')
  assert.equal(merged.importedDocuments[0]?.raw, '{"source":true}')
})

test('normalization rejects malformed persisted state', () => {
  const fallback = createWorkspace('http://127.0.0.1:9000', false)
  assert.equal(normalizeWorkspace({ version: 99 }, fallback), fallback)
  assert.equal(hydrateWorkspace('{not-json', fallback), fallback)
  for (const malformed of [
    { ...fallback, requests: [null] },
    { ...fallback, environments: [null] },
    { ...fallback, scenarios: [{ id: 'broken', name: 'Broken', steps: null }] },
    { ...fallback, mock: { mode: 'unknown' } },
    { ...fallback, requests: [{ ...sampleRequest('http://127.0.0.1:9000'), headers: { bad: null } }] },
  ]) assert.equal(normalizeWorkspace(malformed, fallback), fallback)
})
