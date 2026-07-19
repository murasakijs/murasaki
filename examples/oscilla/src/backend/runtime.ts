import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { emitMainEvent, type MainContext } from 'murasaki/main'
import WebSocket from 'ws'
import { evaluateAssertion, interpolate, parseImport, readJsonPath } from '../lib/protocol.ts'
import { appendLogChunk, drainLogLines } from '../lib/log-buffer.ts'
import { readBoundedResponseBody } from '../lib/net.ts'
import { createWorkspace, mergeImport, parseWorkspace, supportedNodeMessage, supportsOscillaNode } from '../lib/workspace.ts'
import type {
  MockMode,
  RequestInput,
  ResponseRecord,
  RuntimeHealth,
  RuntimeSnapshot,
  ScenarioResult,
  ScenarioStep,
  StreamStatus,
  TimelineEvent,
  WorkspaceState,
} from '../lib/types.ts'

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_WORKSPACE_BYTES = 4 * 1024 * 1024
const MAX_TIMELINE_ROWS = 5_000
const MAX_LINE_BYTES = 16 * 1024
const MAX_QUEUED_LINES = 1_000
const MAX_IMPORTED_LOG_BYTES = 1024 * 1024

interface MockOperation { method: string; path: string; status: number; body: unknown }
interface LinePump { partial: string; queue: string[]; scheduled: boolean; dropped: number; resume?: () => void }

interface RuntimeState {
  context?: MainContext
  db?: DatabaseSync
  server?: Server
  mockUrl: string
  mockMode: MockMode
  mockOperations: MockOperation[]
  sampleData: boolean
  workspace?: WorkspaceState
  health: RuntimeHealth
  docker?: ChildProcessWithoutNullStreams
  dockerAttempt: number
  dockerStatus: StreamStatus
  dockerPumps: LinePump[]
  localPump: LinePump
  localStatus: StreamStatus
}

const key = Symbol.for('oscilla.runtime.v2')
const root = globalThis as typeof globalThis & { [key]?: RuntimeState }
const state = root[key] ??= {
  mockUrl: '', mockMode: 'normal', mockOperations: [], sampleData: true,
  health: { ready: false, database: 'starting', mock: 'starting', message: 'Starting local runtime' },
  dockerAttempt: 0, dockerStatus: { connected: false, message: 'Not attached' }, dockerPumps: [],
  localPump: { partial: '', queue: [], scheduled: false, dropped: 0 },
  localStatus: { connected: false, message: 'No local log selected' },
}

function database(): DatabaseSync {
  if (!state.db) throw new Error('Oscilla Node Main is not ready')
  return state.db
}

function pushRuntimeStatus() {
  emitMainEvent('oscilla.runtime', {
    health: state.health,
    docker: state.dockerStatus,
    localLog: state.localStatus,
    mockMode: state.mockMode,
  })
}

function safeRequestId(value: string | null | undefined): string {
  if (value && /^[A-Za-z0-9._:-]{1,64}$/.test(value)) return value
  return `req_${randomUUID().replaceAll('-', '').slice(0, 8)}`
}

export function appendEvent(event: Omit<TimelineEvent, 'id' | 'occurredAt'> & { occurredAt?: string }): TimelineEvent {
  const occurredAt = event.occurredAt ?? new Date().toISOString()
  const result = database().prepare(`
    INSERT INTO timeline (occurred_at, level, source, service, request_id, summary, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(occurredAt, event.level, event.source, event.service, event.requestId, event.summary, event.detail ?? '')
  const record: TimelineEvent = { ...event, occurredAt, id: Number(result.lastInsertRowid) }
  database().prepare('DELETE FROM timeline WHERE id NOT IN (SELECT id FROM timeline ORDER BY id DESC LIMIT ?)').run(MAX_TIMELINE_ROWS)
  emitMainEvent('oscilla.timeline', record)
  return record
}

function recentEvents(limit = 200): TimelineEvent[] {
  const rows = database().prepare(`
    SELECT id, occurred_at, level, source, service, request_id, summary, detail
    FROM timeline ORDER BY id DESC LIMIT ?
  `).all(Math.max(1, Math.min(limit, 500))) as Array<Record<string, unknown>>
  return rows.reverse().map((row) => ({
    id: Number(row.id), occurredAt: String(row.occurred_at), level: String(row.level) as TimelineEvent['level'],
    source: String(row.source) as TimelineEvent['source'], service: String(row.service), requestId: String(row.request_id),
    summary: String(row.summary), detail: row.detail ? String(row.detail) : undefined,
  }))
}

function saveWorkspace(workspace: WorkspaceState) {
  const serialized = JSON.stringify(workspace)
  if (Buffer.byteLength(serialized) > MAX_WORKSPACE_BYTES) throw new Error('Workspace exceeds the 4 MiB durable storage limit')
  database().prepare(`
    INSERT INTO workspace (id, state_json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
  `).run(serialized, new Date().toISOString())
  state.workspace = workspace
}

function currentWorkspace(): WorkspaceState {
  if (!state.workspace) throw new Error('Workspace is not ready')
  return state.workspace
}

function rebaseLoopbackUrl(value: string): string {
  const decodedTemplates = value.replaceAll('%7B%7B', '{{').replaceAll('%7D%7D', '}}')
  return decodedTemplates.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i, state.mockUrl)
}

function rebaseWorkspaceLoopback(workspace: WorkspaceState): WorkspaceState {
  return {
    ...workspace,
    requests: workspace.requests.map((request) => ({ ...request, url: rebaseLoopbackUrl(request.url) })),
    environments: workspace.environments.map((environment) => environment.name === 'dev' && /127\.0\.0\.1|localhost/.test(environment.baseUrl) ? { ...environment, baseUrl: state.mockUrl } : environment),
    scenarios: workspace.scenarios.map((scenario) => ({ ...scenario, steps: scenario.steps.map((step) => ({ ...step, request: { ...step.request, url: rebaseLoopbackUrl(step.request.url), baseUrl: step.request.environment === 'dev' ? state.mockUrl : step.request.baseUrl } })) })),
  }
}

function readRequestBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.from(chunk)
      size += bytes.byteLength
      if (size > MAX_DOCUMENT_BYTES) {
        request.destroy()
        reject(new Error('Mock request body exceeds 2 MiB'))
        return
      }
      chunks.push(bytes)
    })
    request.once('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.once('error', reject)
  })
}

function jsonBody(body: string): unknown {
  if (!body) return null
  try { return JSON.parse(body) as unknown } catch { return body }
}

function matchMockOperation(method: string, pathname: string): MockOperation | undefined {
  return state.mockOperations.find((operation) => {
    if (operation.method !== method) return false
    const pattern = operation.path.split('/').map((part) => part.startsWith('{') && part.endsWith('}')
      ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')
    return new RegExp(`^${pattern}/?$`).test(pathname)
  })
}

async function handleMock(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
  const requestId = safeRequestId(request.headers['x-request-id'] as string | undefined)
  const started = performance.now()
  const body = await readRequestBody(request)
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const operation = matchMockOperation(request.method ?? 'GET', pathname)
  if (state.mockMode === 'delayed') await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_200))
  const forcedError = state.mockMode === 'error'
  const status = forcedError ? 503 : operation?.status ?? (request.method === 'POST' ? 201 : 200)
  const payload = forcedError
    ? { error: 'mock_failure', message: 'Oscilla forced error mode', requestId }
    : operation?.body ?? {
      status: request.method === 'POST' ? 'created' : 'ok', id: `telemetry_${randomUUID().slice(0, 12)}`, requestId,
      method: request.method, path: request.url, received: jsonBody(body),
    }
  const output = JSON.stringify(payload, null, 2)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(output), 'x-request-id': requestId })
  response.end(output)
  const latency = Math.round(performance.now() - started)
  appendEvent({ level: forcedError ? 'error' : state.mockMode === 'delayed' ? 'warn' : 'info', source: 'HTTP', service: 'oscilla-mock', requestId, summary: `${request.method ?? 'GET'} ${request.url ?? '/'} ${status} (${latency} ms)` })
}

function exampleFromSchema(schema: Record<string, unknown> | undefined): unknown {
  if (!schema) return { ok: true }
  if ('example' in schema) return schema.example
  if (schema.type === 'array') return [exampleFromSchema(schema.items as Record<string, unknown> | undefined)]
  if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') return schema.default ?? null
  return Object.fromEntries(Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([name, property]) => [name, exampleFromSchema(property)]))
}

function openApiOperations(document: string): MockOperation[] {
  if (Buffer.byteLength(document) > MAX_DOCUMENT_BYTES) throw new Error('OpenAPI document exceeds 2 MiB')
  const root = JSON.parse(document) as Record<string, unknown>
  if (!('openapi' in root || 'swagger' in root) || !root.paths || typeof root.paths !== 'object') throw new Error('Expected an OpenAPI JSON document with paths')
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
  const operations: MockOperation[] = []
  for (const [path, pathItem] of Object.entries(root.paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, value] of Object.entries(pathItem as Record<string, unknown>)) {
      if (!methods.has(method) || !value || typeof value !== 'object') continue
      const operation = value as Record<string, unknown>
      const responses = operation.responses && typeof operation.responses === 'object' ? operation.responses as Record<string, unknown> : {}
      const successful = Object.entries(responses).find(([code]) => /^2\d\d$/.test(code))
      const status = successful ? Number(successful[0]) : method === 'post' ? 201 : 200
      const response = successful?.[1] && typeof successful[1] === 'object' ? successful[1] as Record<string, unknown> : {}
      const content = response.content && typeof response.content === 'object' ? response.content as Record<string, unknown> : {}
      const media = content['application/json'] && typeof content['application/json'] === 'object' ? content['application/json'] as Record<string, unknown> : {}
      operations.push({ method: method.toUpperCase(), path, status, body: media.example ?? exampleFromSchema(media.schema as Record<string, unknown> | undefined) })
    }
  }
  if (!operations.length) throw new Error('OpenAPI document contains no supported operations')
  return operations
}

export function installOpenApiDocument(document: string): number {
  state.mockOperations = openApiOperations(document)
  appendEvent({ level: 'info', source: 'APP', service: 'oscilla-mock', requestId: 'openapi', summary: `OpenAPI mock installed (${state.mockOperations.length} operations)` })
  return state.mockOperations.length
}

export async function initializeRuntime(context: MainContext, sampleData: boolean) {
  state.context = context
  state.sampleData = sampleData
  if (!supportsOscillaNode(process.version)) {
    state.health = { ready: false, database: 'error', mock: 'stopped', message: supportedNodeMessage }
    pushRuntimeStatus()
    throw new Error(supportedNodeMessage)
  }
  mkdirSync(context.paths.data, { recursive: true })
  const sqlitePath = join(context.paths.data, 'oscilla.db')
  const { DatabaseSync: SQLiteDatabase } = await import('node:sqlite')
  state.db = new SQLiteDatabase(sqlitePath)
  state.db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, level TEXT NOT NULL,
      source TEXT NOT NULL, service TEXT NOT NULL, request_id TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_quarantine (
      id INTEGER PRIMARY KEY AUTOINCREMENT, state_json TEXT NOT NULL,
      reason TEXT NOT NULL, quarantined_at TEXT NOT NULL
    );
  `)
  state.db.prepare('DELETE FROM timeline WHERE id NOT IN (SELECT id FROM timeline ORDER BY id DESC LIMIT ?)').run(MAX_TIMELINE_ROWS)
  state.health = { ready: false, database: 'connected', mock: 'starting', message: 'Starting loopback mock server' }
  state.server = createServer((request, response) => { void handleMock(request, response).catch((error: unknown) => { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }) })
  await new Promise<void>((resolveListen, reject) => { state.server!.once('error', reject); state.server!.listen(0, '127.0.0.1', () => resolveListen()) })
  const address = state.server.address()
  if (!address || typeof address === 'string') throw new Error('Mock server did not expose a TCP port')
  state.mockUrl = `http://127.0.0.1:${address.port}`
  const fallback = createWorkspace(state.mockUrl, sampleData)
  const row = state.db.prepare('SELECT state_json FROM workspace WHERE id = 1').get() as { state_json?: string } | undefined
  let hydrated = fallback
  if (row?.state_json) {
    try {
      const parsed = parseWorkspace(JSON.parse(row.state_json) as unknown)
      if (!parsed) throw new Error('workspace schema validation failed')
      hydrated = parsed
    } catch (error) {
      state.db.prepare('INSERT INTO workspace_quarantine (state_json, reason, quarantined_at) VALUES (?, ?, ?)')
        .run(row.state_json, error instanceof Error ? error.message : 'invalid workspace', new Date().toISOString())
      state.db.prepare('DELETE FROM workspace_quarantine WHERE id NOT IN (SELECT id FROM workspace_quarantine ORDER BY id DESC LIMIT 5)').run()
    }
  }
  hydrated = rebaseWorkspaceLoopback(hydrated)
  state.workspace = hydrated
  state.mockMode = hydrated.mock.mode
  const openApiDocument = hydrated.importedDocuments.find((document) => document.id === hydrated.mock.openApiDocumentId)
  if (openApiDocument?.kind === 'openapi') state.mockOperations = openApiOperations(openApiDocument.raw)
  saveWorkspace(hydrated)
  if (sampleData && recentEvents(1).length === 0) appendEvent({ level: 'info', source: 'APP', service: 'oscilla', requestId: 'startup', summary: 'Explicit sample workspace initialized' })
  state.health = { ready: true, database: 'connected', mock: 'running', message: 'Local runtime connected' }
  pushRuntimeStatus()
  context.log.info('Oscilla runtime ready', { sqlitePath, mockUrl: state.mockUrl, sampleData })
}

function normalizedUrl(input: RequestInput, variables: Record<string, string>) {
  const raw = interpolate(input.url, variables)
  const url = new URL(raw, input.baseUrl || state.mockUrl)
  const accepted = input.protocol === 'WebSocket' ? ['ws:', 'wss:'] : ['http:', 'https:']
  if (!accepted.includes(url.protocol)) throw new Error(`Unsupported ${input.protocol} URL scheme`)
  return url.toString()
}

export async function executeWebSocket(input: RequestInput, url: string, requestId: string, timeoutMs = 8_000): Promise<ResponseRecord> {
  const started = performance.now()
  const variables = input.variables ?? {}
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers).slice(0, 64)) {
    if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) headers[name] = interpolate(value, variables)
  }
  if (input.bearerToken) headers.authorization = `Bearer ${input.bearerToken}`
  const socket = new WebSocket(url, { headers, maxPayload: MAX_DOCUMENT_BYTES })
  const body = await new Promise<string>((resolveMessage, reject) => {
    let settled = false
    const finish = (error?: Error, value?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      // This is deliberately a one-message workbench probe. `close()` only
      // starts a graceful handshake and can leak a live socket when a peer
      // never answers it, so always tear down the underlying connection.
      try { socket.terminate() } catch { /* already terminated */ }
      if (error) reject(error); else resolveMessage(value ?? '')
    }
    const timeout = setTimeout(() => finish(new Error(`WebSocket response timed out after ${timeoutMs} ms`)), timeoutMs)
    socket.addEventListener('open', () => socket.send(input.body || '{}'), { once: true })
    socket.once('message', (data, isBinary) => finish(undefined, isBinary ? '[binary response]' : data.toString('utf8')))
    socket.once('error', (error) => finish(error))
  })
  const latencyMs = Math.round(performance.now() - started)
  appendEvent({ level: 'info', source: 'WS', service: new URL(url).host, requestId, summary: `WS message received (${latencyMs} ms)` })
  return { requestId, status: 101, statusText: 'Switching Protocols', latencyMs, sizeBytes: Buffer.byteLength(body), headers: {}, body, receivedAt: new Date().toISOString(), ok: true }
}

export async function executeNetwork(input: RequestInput, extraVariables: Record<string, string> = {}): Promise<ResponseRecord> {
  if (!input || typeof input !== 'object') throw new TypeError('request input is required')
  if (Buffer.byteLength(input.body) > MAX_DOCUMENT_BYTES) throw new Error('Request body exceeds 2 MiB')
  const variables = { ...(input.variables ?? {}), ...extraVariables }
  const url = normalizedUrl(input, variables)
  const requestId = safeRequestId(undefined)
  if (input.protocol === 'WebSocket') return executeWebSocket(input, url, requestId)
  const started = performance.now()
  const headers = new Headers()
  for (const [name, value] of Object.entries(input.headers).slice(0, 64)) if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) headers.set(name, interpolate(value, variables))
  headers.set('x-request-id', requestId)
  if (input.bearerToken) headers.set('authorization', `Bearer ${input.bearerToken}`)
  if (input.protocol === 'GraphQL') headers.set('content-type', 'application/json')
  const method = input.protocol === 'GraphQL' ? 'POST' : input.method.toUpperCase()
  const response = await fetch(url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : interpolate(input.body, variables), signal: AbortSignal.timeout(15_000) })
  const body = await readBoundedResponseBody(response)
  const latencyMs = Math.round(performance.now() - started)
  const record: ResponseRecord = { requestId, status: response.status, statusText: response.statusText, latencyMs, sizeBytes: Buffer.byteLength(body), headers: Object.fromEntries(response.headers.entries()), body, receivedAt: new Date().toISOString(), ok: response.ok }
  appendEvent({ level: response.ok ? 'info' : 'error', source: 'HTTP', service: new URL(url).host, requestId, summary: `${method} ${new URL(url).pathname} ${response.status} (${latencyMs} ms)` })
  return record
}

export async function executeScenario(steps: ScenarioStep[]): Promise<ScenarioResult[]> {
  if (!Array.isArray(steps) || steps.length > 24) throw new Error('Scenario accepts at most 24 steps')
  const variables: Record<string, string> = { ...currentWorkspace().variables }
  const results: ScenarioResult[] = []
  for (const step of steps) {
    try {
      const response = await executeNetwork(step.request, variables)
      const assertionResults = step.assertions.map((assertion) => evaluateAssertion(assertion, response))
      const passed = assertionResults.every((assertion) => assertion.passed)
      if (passed && step.extract) {
        const value = readJsonPath(response.body, step.extract.path)
        if (value !== undefined) variables[step.extract.variable] = value
      }
      results.push({ stepId: step.id, name: step.name, passed, response, assertionResults })
      if (!passed) break
    } catch (error) {
      results.push({ stepId: step.id, name: step.name, passed: false, assertionResults: [], error: error instanceof Error ? error.message : String(error) })
      break
    }
  }
  return results
}

export function snapshot(): RuntimeSnapshot {
  return { mockUrl: state.mockUrl, mockMode: state.mockMode, sampleData: state.sampleData, sqlitePath: state.context ? join(state.context.paths.data, 'oscilla.db') : 'not-ready', events: recentEvents(), health: state.health, workspace: currentWorkspace(), docker: state.dockerStatus, localLog: state.localStatus }
}

export function updateWorkspace(next: WorkspaceState): RuntimeSnapshot {
  const normalized = parseWorkspace(next)
  if (!normalized) throw new TypeError('Workspace failed deep schema validation')
  saveWorkspace(normalized)
  state.mockMode = normalized.mock.mode
  const document = normalized.importedDocuments.find((item) => item.id === normalized.mock.openApiDocumentId)
  state.mockOperations = document?.kind === 'openapi' ? openApiOperations(document.raw) : []
  emitMainEvent('oscilla.workspace', normalized)
  return snapshot()
}

export function importWorkspaceDocument(document: string): RuntimeSnapshot {
  if (Buffer.byteLength(document) > MAX_DOCUMENT_BYTES) throw new Error('Import exceeds 2 MiB')
  const imported = parseImport(document)
  const merged = mergeImport(currentWorkspace(), imported, document)
  saveWorkspace(merged)
  if (imported.kind === 'openapi') state.mockOperations = openApiOperations(document)
  emitMainEvent('oscilla.workspace', merged)
  appendEvent({ level: 'info', source: 'APP', service: 'oscilla', requestId: 'import', summary: `${imported.title}: ${imported.requests.length} requests imported` })
  return snapshot()
}

export function setMode(mode: MockMode): RuntimeSnapshot {
  if (!['normal', 'delayed', 'error'].includes(mode)) throw new Error('Invalid mock mode')
  state.mockMode = mode
  saveWorkspace({ ...currentWorkspace(), mock: { ...currentWorkspace().mock, mode } })
  appendEvent({ level: mode === 'error' ? 'error' : mode === 'delayed' ? 'warn' : 'info', source: 'APP', service: 'oscilla-mock', requestId: 'configuration', summary: `Mock mode changed to ${mode}` })
  pushRuntimeStatus()
  return snapshot()
}

function pumpLines(pump: LinePump, chunk: string, consume: (line: string) => void, pause?: () => void, resume?: () => void) {
  appendLogChunk(pump, chunk, MAX_LINE_BYTES, MAX_QUEUED_LINES)
  if (pump.queue.length > 800 && pause) { pause(); pump.resume = resume }
  if (pump.scheduled) return
  pump.scheduled = true
  const flush = () => {
    for (const line of drainLogLines(pump, 100)) consume(line)
    if (pump.queue.length) setImmediate(flush)
    else {
      if (pump.dropped) { consume(`[Oscilla dropped ${pump.dropped} excess log lines]`); pump.dropped = 0 }
      pump.scheduled = false
      pump.resume?.(); pump.resume = undefined
    }
  }
  setImmediate(flush)
}

function emitLogLine(source: 'DOCKER' | 'LOCAL', service: string, line: string, error = false) {
  const cleaned = line.trim()
  if (!cleaned) return
  const requestId = cleaned.match(/(?:request[_ -]?id[=: ]+)([A-Za-z0-9._:-]+)/i)?.[1] ?? source.toLowerCase()
  appendEvent({ level: error || /\b(error|fatal)\b/i.test(cleaned) ? 'error' : /\bwarn(?:ing)?\b/i.test(cleaned) ? 'warn' : 'info', source, service, requestId, summary: cleaned })
}

export async function listDocker(): Promise<string[]> {
  return new Promise((resolveList) => {
    const child = spawn('docker', ['ps', '--format', '{{.Names}}'], { shell: false })
    let output = ''
    child.stdout.on('data', (chunk) => { if (output.length < 64_000) output += String(chunk) })
    child.once('error', () => resolveList([]))
    child.once('close', (code) => resolveList(code === 0 ? output.split(/\r?\n/).filter(Boolean).slice(0, 100) : []))
  })
}

export function detachDocker(): StreamStatus {
  state.dockerAttempt += 1
  state.docker?.kill()
  state.docker = undefined
  state.dockerPumps = []
  state.dockerStatus = { connected: false, message: 'Not attached' }
  pushRuntimeStatus()
  return state.dockerStatus
}

async function inspectDockerContainer(container: string): Promise<string | undefined> {
  return new Promise((resolveInspection) => {
    const child = spawn('docker', ['container', 'inspect', '--format', '{{.Name}}', container], { shell: false })
    let settled = false
    let errorOutput = ''
    const finish = (error?: string) => {
      if (settled) return
      settled = true
      resolveInspection(error)
    }
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { if (errorOutput.length < 16_000) errorOutput += chunk })
    child.once('error', (error) => finish(error.message))
    child.once('close', (code) => finish(code === 0 ? undefined : errorOutput.trim() || `Docker inspect exited with ${code ?? 'a signal'}`))
  })
}

export async function attachDocker(container: string): Promise<StreamStatus> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container)) throw new Error('Enter a safe Docker container name')
  detachDocker()
  const attempt = state.dockerAttempt
  state.dockerStatus = { connected: false, connecting: true, message: 'Checking Docker container', target: container }
  pushRuntimeStatus()
  const inspectionError = await inspectDockerContainer(container)
  if (attempt !== state.dockerAttempt) return state.dockerStatus
  if (inspectionError) {
    state.dockerStatus = { connected: false, message: inspectionError, target: container }
    emitLogLine('DOCKER', container, `Docker attach failed: ${inspectionError}`, true)
    pushRuntimeStatus()
    return state.dockerStatus
  }
  const child = spawn('docker', ['logs', '--follow', '--tail', '40', container], { shell: false })
  state.docker = child
  state.dockerStatus = { connected: false, connecting: true, message: 'Connecting to Docker output', target: container }
  const stdoutPump: LinePump = { partial: '', queue: [], scheduled: false, dropped: 0 }
  const stderrPump: LinePump = { partial: '', queue: [], scheduled: false, dropped: 0 }
  state.dockerPumps = [stdoutPump, stderrPump]
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.once('spawn', () => {
    if (state.docker !== child) return
    state.dockerStatus = { connected: true, message: 'Following live Docker output', target: container }
    pushRuntimeStatus()
  })
  child.stdout.on('data', (chunk: string) => pumpLines(stdoutPump, chunk, (line) => emitLogLine('DOCKER', container, line), () => child.stdout.pause(), () => child.stdout.resume()))
  child.stderr.on('data', (chunk: string) => pumpLines(stderrPump, chunk, (line) => emitLogLine('DOCKER', container, line, true), () => child.stderr.pause(), () => child.stderr.resume()))
  child.once('error', (error) => { if (state.docker !== child) return; state.dockerStatus = { connected: false, message: error.message, target: container }; emitLogLine('DOCKER', container, `Docker attach failed: ${error.message}`, true); pushRuntimeStatus() })
  child.once('close', (code) => {
    if (state.docker !== child) return
    if (stdoutPump.partial) emitLogLine('DOCKER', container, stdoutPump.partial)
    if (stderrPump.partial) emitLogLine('DOCKER', container, stderrPump.partial, true)
    state.docker = undefined; state.dockerStatus = { connected: false, message: `Docker log stream ended (${code ?? 'signal'})`, target: container }; pushRuntimeStatus()
  })
  pushRuntimeStatus()
  return state.dockerStatus
}

export async function importLocalLog(name: string, content: string): Promise<StreamStatus> {
  await detachLocalLog()
  const safeName = name.split(/[\\/]/).pop()?.trim() ?? ''
  if (!safeName || safeName.length > 255 || safeName.includes('\0')) throw new Error('Select a valid log file')
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_IMPORTED_LOG_BYTES) throw new Error('Log snapshot exceeds the 1 MiB import limit')

  state.localPump = { partial: '', queue: [], scheduled: false, dropped: 0 }
  const tail = Buffer.from(content, 'utf8').subarray(Math.max(0, bytes - 64 * 1024)).toString('utf8')
  pumpLines(state.localPump, tail, (line) => emitLogLine('LOCAL', safeName, line))
  if (state.localPump.partial) {
    emitLogLine('LOCAL', safeName, state.localPump.partial)
    state.localPump.partial = ''
  }
  state.localStatus = { connected: true, message: 'Imported local log snapshot', target: safeName }
  pushRuntimeStatus()
  return state.localStatus
}

export async function detachLocalLog(): Promise<StreamStatus> {
  state.localStatus = { connected: false, message: 'No local log selected' }
  pushRuntimeStatus()
  return state.localStatus
}

export function resetState(): RuntimeSnapshot {
  database().exec('DELETE FROM timeline; VACUUM;')
  state.mockMode = 'normal'; state.mockOperations = []
  const fresh = createWorkspace(state.mockUrl, state.sampleData)
  saveWorkspace(fresh)
  appendEvent({ level: 'info', source: 'APP', service: 'oscilla', requestId: 'reset', summary: 'Workspace reset completed' })
  emitMainEvent('oscilla.workspace', fresh)
  pushRuntimeStatus()
  return snapshot()
}

export async function shutdownRuntime() {
  detachDocker()
  await detachLocalLog()
  if (state.server) await new Promise<void>((resolveClose) => state.server!.close(() => resolveClose()))
  state.server = undefined
  state.health = { ready: false, database: state.db ? 'connected' : 'starting', mock: 'stopped', message: 'Runtime stopped' }
  state.db?.close(); state.db = undefined
}
