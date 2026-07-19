import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateAssertion, interpolate, parseImport, parseOpenApi, parsePostman, readJsonPath } from './protocol.ts'

test('imports OpenAPI JSON operations', () => {
  const result = parseOpenApi(JSON.stringify({
    openapi: '3.1.0', info: { title: 'Telemetry' }, servers: [{ url: 'http://localhost:9' }],
    paths: { '/events': { post: { summary: 'Create event', requestBody: {} } } },
  }))
  assert.equal(result.requests[0]?.name, 'Create event')
  assert.equal(result.requests[0]?.url, 'http://localhost:9/events')
})

test('imports nested Postman requests and variables', () => {
  const result = parsePostman(JSON.stringify({
    info: { name: 'Collection' }, variable: [{ key: 'host', value: 'localhost' }],
    item: [{ name: 'Folder', item: [{ name: 'Health', request: { method: 'GET', url: 'http://{{host}}/health' } }] }],
  }))
  assert.equal(result.variables.host, 'localhost')
  assert.equal(result.requests[0]?.name, 'Health')
})

test('interpolates and evaluates chained assertions', () => {
  assert.equal(interpolate('/things/{{id}}', { id: '42' }), '/things/42')
  const response = { status: 201, latencyMs: 20, body: '{"id":"abc"}' } as Parameters<typeof evaluateAssertion>[1]
  assert.equal(evaluateAssertion({ kind: 'status', operator: 'eq', expected: 201 }, response).passed, true)
  assert.equal(readJsonPath(response.body, '$.id'), 'abc')
})

test('imports every operation from a multi-path OpenAPI document', () => {
  const imported = parseOpenApi(JSON.stringify({
    openapi: '3.1.0', info: { title: 'Many operations' }, servers: [{ url: 'https://api.test' }],
    paths: { '/one': { get: { summary: 'One' }, post: { summary: 'Create one', requestBody: {} } }, '/two': { delete: { summary: 'Delete two' } } },
  }))
  assert.deepEqual(imported.requests.map((request) => request.method), ['GET', 'POST', 'DELETE'])
})

test('rejects unsupported imports without guessing', () => {
  assert.throws(() => parseImport('{"hello":"world"}'), /Supported formats/)
})

test('returns undefined for missing or invalid JSON paths', () => {
  assert.equal(readJsonPath('{"a":{"b":3}}', '$.a.c'), undefined)
  assert.equal(readJsonPath('not json', '$.a'), undefined)
})
