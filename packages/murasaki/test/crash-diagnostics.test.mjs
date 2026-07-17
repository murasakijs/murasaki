import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  createCrashDiagnostics,
  isValidCrashReportId,
  writeCrashReportSync,
} from '../dist/main/crash-reports.js'
import { defineConfig, resolveDiagnosticsConfig, validateConfig } from '../dist/config.js'
import { metaJson } from '../dist/cli/bundle.js'

const packageDir = resolve(import.meta.dirname, '..')

async function fixtureDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'murasaki-crash-reports-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

// ── Report write + rotation + clamping ─────────────────────────────────────

test('writes a versioned crash report and rotates to the newest N by filename', async (t) => {
  const dir = await fixtureDir(t)

  const filenames = []
  for (let index = 0; index < 25; index++) {
    const filename = writeCrashReportSync(dir, {
      domain: 'node',
      message: `boom ${index}`,
      appVersion: '1.0.0',
      frameworkVersion: '0.37.0',
    }, 20)
    filenames.push(filename)
    // Filenames are second-resolution-safe but millisecond-prefixed; a tiny
    // delay keeps each write's timestamp component strictly increasing so
    // sorted-filename order matches write order deterministically.
    await new Promise((resolveOk) => setTimeout(resolveOk, 2))
  }

  const filesOnDisk = (await readdir(dir)).sort()
  assert.equal(filesOnDisk.length, 20, 'rotation keeps only the newest 20 by default')
  assert.deepEqual(filesOnDisk, [...filenames].sort().slice(-20))

  const diagnostics = createCrashDiagnostics(dir)
  const list = await diagnostics.listCrashReports()
  assert.equal(list.length, 20)
  assert.ok(list.every((entry) => entry.domain === 'node'))
  assert.ok(list.every((entry) => entry.appVersion === '1.0.0'))

  const newest = list.at(-1)
  const report = await diagnostics.readCrashReport(newest.id)
  assert.equal(report.reportVersion, 1)
  assert.equal(report.message, 'boom 24')
  assert.equal(report.domain, 'node')
  assert.equal(report.frameworkVersion, '0.37.0')
  assert.equal(typeof report.os, 'string')
  assert.equal(typeof report.arch, 'string')
})

test('keepReports is clamped to at least 1 even when configured lower', async (t) => {
  const dir = await fixtureDir(t)
  for (let index = 0; index < 5; index++) {
    writeCrashReportSync(dir, {
      domain: 'renderer',
      message: `err ${index}`,
      appVersion: '1.0.0',
      frameworkVersion: '0.37.0',
    }, 0)
    await new Promise((resolveOk) => setTimeout(resolveOk, 2))
  }
  const files = await readdir(dir)
  assert.equal(files.length, 1, 'a keepReports of 0 is clamped up to 1, never 0')
})

test('clearCrashReports removes every report but leaves the directory usable', async (t) => {
  const dir = await fixtureDir(t)
  writeCrashReportSync(dir, {
    domain: 'native',
    message: 'panic',
    appVersion: '1.0.0',
    frameworkVersion: '0.37.0',
  })
  const diagnostics = createCrashDiagnostics(dir)
  assert.equal((await diagnostics.listCrashReports()).length, 1)
  await diagnostics.clearCrashReports()
  assert.equal((await diagnostics.listCrashReports()).length, 0)
})

// ── Bounding + redaction ────────────────────────────────────────────────────

test('bounds message/stack length and redacts secret-looking extra fields', async (t) => {
  const dir = await fixtureDir(t)
  const filename = writeCrashReportSync(dir, {
    domain: 'node',
    message: 'x'.repeat(20_000),
    stack: 'y'.repeat(50_000),
    extra: { accessToken: 'never-write-me', cookie: 'private', queueDepth: 0 },
    appVersion: '1.0.0',
    frameworkVersion: '0.37.0',
  })
  const report = JSON.parse(await readFile(join(dir, filename), 'utf8'))
  assert.ok(report.message.length < 20_000)
  assert.ok(report.message.endsWith('…[truncated]'))
  assert.ok(report.stack.length < 50_000)
  assert.ok(report.stack.endsWith('…[truncated]'))
  assert.equal(report.extra.accessToken, '[redacted]')
  assert.equal(report.extra.cookie, '[redacted]')
  assert.equal(report.extra.queueDepth, 0)
})

// ── Id validation rejects traversal ─────────────────────────────────────────

test('crash report ids reject path traversal and unsafe characters', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-crash-traversal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'crash-reports')
  await mkdir(dir, { recursive: true })
  await writeFile(join(root, 'outside.json'), JSON.stringify({ secret: true }))
  writeCrashReportSync(dir, {
    domain: 'node',
    message: 'inside',
    appVersion: '1.0.0',
    frameworkVersion: '0.37.0',
  })

  for (const unsafeId of [
    '../outside.json',
    '..%2Foutside.json',
    'a/../../outside.json',
    '.hidden.json',
    'a\\b.json',
    'no-extension',
    '',
    '..',
  ]) {
    assert.equal(isValidCrashReportId(unsafeId), false, `expected ${JSON.stringify(unsafeId)} to be rejected`)
  }

  const diagnostics = createCrashDiagnostics(dir)
  for (const unsafeId of ['../outside.json', '..', '.hidden.json']) {
    assert.equal(await diagnostics.readCrashReport(unsafeId), null)
  }
  const valid = (await diagnostics.listCrashReports())[0]
  assert.ok(await diagnostics.readCrashReport(valid.id))
})

// ── Config validation ───────────────────────────────────────────────────────

test('diagnostics config validates types and resolves defaults/clamping', () => {
  const base = { appId: 'dev.test.diagnostics', productName: 'Diagnostics Test' }

  assert.deepEqual(resolveDiagnosticsConfig({}), { crashReports: true, keepReports: 20 })
  assert.deepEqual(
    resolveDiagnosticsConfig({ diagnostics: { crashReports: false } }),
    { crashReports: false, keepReports: 20 },
  )
  assert.deepEqual(
    resolveDiagnosticsConfig({ diagnostics: { keepReports: 500 } }),
    { crashReports: true, keepReports: 100 },
  )
  assert.deepEqual(
    resolveDiagnosticsConfig({ diagnostics: { keepReports: -5 } }),
    { crashReports: true, keepReports: 1 },
  )

  assert.throws(
    () => validateConfig({ ...base, diagnostics: { crashReports: 'yes' } }),
    /diagnostics\.crashReports must be a boolean/,
  )
  assert.throws(
    () => validateConfig({ ...base, diagnostics: { keepReports: 1.5 } }),
    /diagnostics\.keepReports must be a safe integer/,
  )
  assert.throws(
    () => validateConfig({ ...base, diagnostics: { unknown: true } }),
    /diagnostics contains unknown field/,
  )
  assert.throws(
    () => validateConfig({ ...base, diagnostics: 'nope' }),
    /diagnostics must be an object/,
  )

  const config = defineConfig({ ...base, diagnostics: { keepReports: 40 } })
  assert.equal(config.diagnostics.keepReports, 40)
})

test('bundle metadata carries the framework version and resolved diagnostics defaults', () => {
  const config = defineConfig({
    appId: 'dev.test.diagnostics-meta',
    productName: 'Diagnostics Meta Test',
    diagnostics: { keepReports: 7 },
  })
  const metadata = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(metadata.diagnostics, { crashReports: true, keepReports: 7 })
  assert.equal(typeof metadata.frameworkVersion, 'string')
  assert.match(metadata.frameworkVersion, /^\d+\.\d+\.\d+/)
})

// ── Renderer endpoint auth + capture (extends prod-server-http.test.mjs's pattern) ──

async function copyMainRuntimeFixture(root) {
  const runtimeRoot = join(root, '.murasaki-runtime')
  const runtimeDir = join(runtimeRoot, 'runtime')
  const mainDir = join(runtimeRoot, 'main')
  await mkdir(runtimeDir, { recursive: true })
  await mkdir(mainDir, { recursive: true })
  await Promise.all([
    copyFile(join(packageDir, 'dist/runtime/main-runtime.js'), join(runtimeDir, 'main-runtime.js')),
    copyFile(join(packageDir, 'dist/main/logger.js'), join(mainDir, 'logger.js')),
    copyFile(join(packageDir, 'dist/main/sidecar.js'), join(mainDir, 'sidecar.js')),
    copyFile(join(packageDir, 'dist/main/crash-reports.js'), join(mainDir, 'crash-reports.js')),
    writeFile(join(runtimeRoot, 'package.json'), '{"private":true,"type":"module"}\n'),
  ])
}

async function startProdServer(t, { diagnostics } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-crash-server-'))
  const clientDir = join(root, 'client')
  const serverDir = join(root, 'server')
  await mkdir(clientDir)
  await mkdir(serverDir)
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>test</title>')
  await writeFile(join(serverDir, 'actions.mjs'), 'export const registry = {}\n')
  await writeFile(join(serverDir, 'main-actions.mjs'), 'export const registry = {}\n')
  await writeFile(join(serverDir, 'main.mjs'), 'export default {}\n')
  await writeFile(join(serverDir, 'routes.mjs'), 'export const routes = []\n')
  await writeFile(join(root, 'murasaki-meta.json'), JSON.stringify({
    appId: 'com.example.crash-diagnostics-test',
    productName: 'Crash Diagnostics Test',
    version: '2.0.0',
    frameworkVersion: '9.9.9',
    diagnostics: diagnostics ?? { crashReports: true, keepReports: 5 },
  }))
  await copyFile(join(packageDir, 'assets/prod-server.mjs'), join(root, 'prod-server.mjs'))
  await copyFile(join(packageDir, 'dist/runtime/updater.js'), join(root, 'updater-engine.mjs'))
  await copyFile(join(packageDir, 'dist/runtime/wire.js'), join(root, 'wire.mjs'))
  await copyMainRuntimeFixture(root)

  const child = spawn(
    process.execPath,
    [
      join(root, 'prod-server.mjs'),
      '--client', clientDir,
      '--registry', join(serverDir, 'actions.mjs'),
      '--main-registry', join(serverDir, 'main-actions.mjs'),
      '--routes', join(serverDir, 'routes.mjs'),
      '--main', join(serverDir, 'main.mjs'),
      '--port', '0',
    ],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: '',
        HOME: root,
        XDG_DATA_HOME: join(root, 'xdg-data'),
        XDG_CACHE_HOME: join(root, 'xdg-cache'),
        XDG_STATE_HOME: join(root, 'xdg-state'),
      },
    },
  )
  t.after(async () => {
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), new Promise((resolveOk) => setTimeout(resolveOk, 1000))])
    await rm(root, { recursive: true, force: true })
  })

  const rl = createInterface({ input: child.stdout })
  const port = await new Promise((resolveOk, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not report a port')), 5000)
    rl.on('line', (line) => {
      const match = /^MURASAKI_PORT=(\d+)$/.exec(line)
      if (!match) return
      clearTimeout(timeout)
      resolveOk(Number(match[1]))
    })
    child.once('exit', (code) => reject(new Error(`server exited early (${code})`)))
  })

  const bootstrap = await fetch(`http://127.0.0.1:${port}/`)
  const runtimeCookie = bootstrap.headers.getSetCookie()[0].split(';', 1)[0]
  return {
    root,
    port,
    crashReportsDir: join(root, 'Library', 'Application Support', 'com.example.crash-diagnostics-test', 'crash-reports'),
    runtimeHeaders: { cookie: runtimeCookie, 'content-type': 'application/json' },
  }
}

test('renderer diagnostics endpoint requires the session cookie but not the native token', async (t) => {
  const { port, crashReportsDir, runtimeHeaders } = await startProdServer(t)
  const url = `http://127.0.0.1:${port}/__murasaki/diagnostics/renderer-error`

  const unauthenticated = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'boom', source: 'error' }),
  })
  assert.equal(unauthenticated.status, 403)

  const invalidPayload = await fetch(url, {
    method: 'POST',
    headers: runtimeHeaders,
    body: JSON.stringify({ message: '', source: 'error' }),
  })
  assert.equal(invalidPayload.status, 400)

  const invalidSource = await fetch(url, {
    method: 'POST',
    headers: runtimeHeaders,
    body: JSON.stringify({ message: 'boom', source: 'not-a-real-source' }),
  })
  assert.equal(invalidSource.status, 400)

  // No native token attached — proves this is on the session-cookie tier,
  // not the native-only tier used by e.g. /__murasaki/main/shutdown.
  const accepted = await fetch(url, {
    method: 'POST',
    headers: runtimeHeaders,
    body: JSON.stringify({
      message: 'Cannot read properties of undefined',
      stack: 'TypeError: Cannot read properties of undefined\n    at App (App.tsx:10:5)',
      source: 'error',
    }),
  })
  assert.equal(accepted.status, 204)

  const files = await readdir(crashReportsDir)
  assert.equal(files.length, 1)
  const report = JSON.parse(await readFile(join(crashReportsDir, files[0]), 'utf8'))
  assert.equal(report.domain, 'renderer')
  assert.equal(report.message, 'Cannot read properties of undefined')
  assert.equal(report.appVersion, '2.0.0')
  assert.equal(report.frameworkVersion, '9.9.9')
  assert.equal(report.extra.source, 'error')
})

test('renderer diagnostics endpoint is a no-op when diagnostics.crashReports is disabled', async (t) => {
  const { port, crashReportsDir, runtimeHeaders } = await startProdServer(t, {
    diagnostics: { crashReports: false, keepReports: 20 },
  })
  const url = `http://127.0.0.1:${port}/__murasaki/diagnostics/renderer-error`

  const response = await fetch(url, {
    method: 'POST',
    headers: runtimeHeaders,
    body: JSON.stringify({ message: 'should not be captured', source: 'unhandledrejection' }),
  })
  assert.equal(response.status, 204)
  await assert.rejects(readdir(crashReportsDir))
})

// ── Node domain: uncaughtException/unhandledRejection hooks (isolated subprocess) ──

test('an uncaught exception writes a node crash report before the process exits non-zero', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-crash-node-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataDir = join(root, 'data')
  const script = join(root, 'crash.mjs')
  await writeFile(script, `
import { MainRuntime } from ${JSON.stringify(join(packageDir, 'dist/runtime/main-runtime.js'))}

const runtime = new MainRuntime({
  appId: 'com.example.node-crash-test',
  productName: 'Node Crash Test',
  version: '3.0.0',
  frameworkVersion: '9.9.9',
  projectRoot: ${JSON.stringify(root)},
  resourcesPath: ${JSON.stringify(root)},
  isPackaged: false,
  paths: {
    data: ${JSON.stringify(dataDir)},
    cache: ${JSON.stringify(join(root, 'cache'))},
    logs: ${JSON.stringify(join(root, 'logs'))},
    temp: ${JSON.stringify(join(root, 'temp'))},
  },
  diagnostics: { crashReports: true, keepReports: 20 },
})
await runtime.start(async () => ({ default: {} }))
setImmediate(() => { throw new Error('deliberate test crash') })
`)

  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'ignore', 'ignore'] })
  const [code] = await once(child, 'exit')
  assert.equal(code, 1, 'the process still exits non-zero, same as Node\'s default uncaughtException behavior')

  const files = await readdir(join(dataDir, 'crash-reports'))
  assert.equal(files.length, 1)
  const report = JSON.parse(await readFile(join(dataDir, 'crash-reports', files[0]), 'utf8'))
  assert.equal(report.domain, 'node')
  assert.equal(report.message, 'deliberate test crash')
  assert.equal(report.appVersion, '3.0.0')
  assert.equal(report.frameworkVersion, '9.9.9')
  assert.match(report.stack, /deliberate test crash/)
})

test('diagnostics.crashReports: false leaves Node\'s default uncaughtException behavior untouched', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-crash-node-disabled-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataDir = join(root, 'data')
  const script = join(root, 'crash.mjs')
  await writeFile(script, `
import { MainRuntime } from ${JSON.stringify(join(packageDir, 'dist/runtime/main-runtime.js'))}

const runtime = new MainRuntime({
  appId: 'com.example.node-crash-disabled-test',
  productName: 'Node Crash Disabled Test',
  version: '3.0.0',
  projectRoot: ${JSON.stringify(root)},
  resourcesPath: ${JSON.stringify(root)},
  isPackaged: false,
  paths: {
    data: ${JSON.stringify(dataDir)},
    cache: ${JSON.stringify(join(root, 'cache'))},
    logs: ${JSON.stringify(join(root, 'logs'))},
    temp: ${JSON.stringify(join(root, 'temp'))},
  },
  diagnostics: { crashReports: false },
})
await runtime.start(async () => ({ default: {} }))
setImmediate(() => { throw new Error('deliberate test crash') })
`)

  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'ignore', 'ignore'] })
  const [code] = await once(child, 'exit')
  assert.equal(code, 1)
  await assert.rejects(readdir(join(dataDir, 'crash-reports')))
})
