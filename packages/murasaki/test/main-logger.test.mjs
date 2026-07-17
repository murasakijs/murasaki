import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createMainLogger } from '../dist/main/index.js'

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'murasaki-main-log-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return {
    directory,
    log: createMainLogger({
      directory,
      appId: 'dev.test.logs',
      productName: 'Log Test',
      version: '1.2.3',
      console: false,
      ...options,
    }),
  }
}

test('writes structured records and redacts nested secret fields', async (t) => {
  const { log } = await fixture(t)
  const circular = { value: 1 }
  circular.self = circular
  log.info('signed in', {
    user: { id: '42', accessToken: 'never-write-me' },
    cookie: 'private',
    circular,
  })
  await log.flush()
  const record = JSON.parse((await readFile(log.path, 'utf8')).trim())
  assert.equal(record.message, 'signed in')
  assert.equal(record.fields.user.accessToken, '[redacted]')
  assert.equal(record.fields.cookie, '[redacted]')
  assert.equal(record.fields.circular.self, '[circular]')
})

test('rotates bounded logs without losing the active file', async (t) => {
  const { directory, log } = await fixture(t, { maxBytes: 180, maxFiles: 2 })
  for (let index = 0; index < 8; index++) log.info(`record-${index}`, { text: 'x'.repeat(80) })
  await log.flush()
  const files = await readdir(directory)
  assert.ok(files.includes('murasaki-main.jsonl'))
  assert.ok(files.includes('murasaki-main.jsonl.1'))
  assert.ok(files.length <= 3)
})

test('creates a bounded diagnostic report with redacted app state', async (t) => {
  const { log } = await fixture(t)
  log.error('request failed', { authorization: 'Bearer secret' })
  const reportPath = await log.createDiagnosticReport({
    maxLogBytes: 1024,
    extra: { apiKey: 'secret', connection: 'offline' },
  })
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.application.version, '1.2.3')
  assert.equal(report.extra.apiKey, '[redacted]')
  assert.equal(report.extra.connection, 'offline')
  assert.equal(report.logs.length, 1)
  assert.doesNotMatch(report.logs[0].content, /Bearer secret/)
})
