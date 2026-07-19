import type { EnvironmentConfig, ImportedWorkspace, RequestDraft, ScenarioDefinition, WorkspaceState } from './types.ts'

export const supportedNodeMessage = 'Oscilla requires Node 22.13 or newer (or Node 24+) because node:sqlite is unflagged from Node 22.13.'

export function supportsOscillaNode(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number)
  return major >= 24 || (major === 22 && minor >= 13)
}

export function sampleRequest(mockUrl: string): RequestDraft {
  return {
    id: 'sample-create-telemetry', name: 'Create telemetry', protocol: 'REST', method: 'POST',
    url: `${mockUrl}/api/v1/telemetry`, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: 'device_12345', metrics: { temperature: 23.7, humidity: 45.2, battery: 89 }, tags: ['lab', 'sample', 'oscilla'] }, null, 2),
  }
}

export function sampleScenario(request: RequestDraft, mockUrl: string): ScenarioDefinition {
  return {
    id: 'sample-telemetry-flow', name: 'Telemetry ingestion flow', steps: [
      {
        id: 'create', name: 'Create telemetry',
        request: { ...request, environment: 'dev', baseUrl: mockUrl, variables: { baseUrl: mockUrl } },
        assertions: [{ kind: 'status', operator: 'eq', expected: 201 }, { kind: 'latency', operator: 'lt', expected: 2500 }],
        extract: { variable: 'telemetryId', path: '$.id' },
      },
      {
        id: 'read', name: 'Read extracted telemetry',
        request: { ...request, id: 'sample-read-telemetry', name: 'Read telemetry', method: 'GET', url: `${mockUrl}/api/v1/telemetry/{{telemetryId}}`, body: '', environment: 'dev', baseUrl: mockUrl },
        assertions: [{ kind: 'status', operator: 'eq', expected: 200 }],
      },
    ],
  }
}

export function createWorkspace(mockUrl: string, sampleData: boolean): WorkspaceState {
  const environments: EnvironmentConfig[] = [
    { name: 'dev', baseUrl: mockUrl },
    { name: 'staging', baseUrl: 'https://staging.example.test' },
    { name: 'prod', baseUrl: 'https://api.example.test' },
  ]
  if (!sampleData) return { version: 1, activeRequestId: null, requests: [], collections: [], environments, variables: {}, scenarios: [], importedDocuments: [], mock: { mode: 'normal' } }
  const request = sampleRequest(mockUrl)
  return {
    version: 1,
    activeRequestId: request.id,
    requests: [request],
    collections: [{ id: 'sample-collection', name: 'Oscilla samples', requestIds: [request.id] }],
    environments,
    variables: {},
    scenarios: [sampleScenario(request, mockUrl)],
    importedDocuments: [],
    mock: { mode: 'normal' },
  }
}

export function mergeImport(workspace: WorkspaceState, imported: ImportedWorkspace, raw: string, importedAt = new Date().toISOString()): WorkspaceState {
  const prefix = `import-${workspace.importedDocuments.length + 1}`
  const requests = imported.requests.map((request, index) => ({ ...request, id: `${prefix}-${index + 1}` }))
  return {
    ...workspace,
    activeRequestId: requests[0]?.id ?? workspace.activeRequestId,
    requests: [...workspace.requests, ...requests],
    collections: [...workspace.collections, { id: `${prefix}-collection`, name: imported.title, requestIds: requests.map((request) => request.id) }],
    variables: { ...workspace.variables, ...imported.variables },
    importedDocuments: [...workspace.importedDocuments, {
      id: prefix, kind: imported.kind, title: imported.title, importedAt, raw, requestIds: requests.map((request) => request.id),
    }],
    mock: imported.kind === 'openapi' ? { ...workspace.mock, openApiDocumentId: prefix } : workspace.mock,
  }
}

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const id = (value: unknown): value is string => text(value, 128) && /^[A-Za-z0-9._:-]+$/.test(value)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const stringRecord = (value: unknown, maxEntries = 256): value is Record<string, string> => record(value)
  && Object.keys(value).length <= maxEntries
  && Object.entries(value).every(([key, entry]) => text(key, 128) && text(entry, 16_384))

function validRequest(value: unknown, input = false): value is RequestDraft {
  if (!record(value) || !id(value.id) || !text(value.name, 256)
    || !['REST', 'GraphQL', 'WebSocket'].includes(String(value.protocol))
    || !text(value.method, 16) || !text(value.url, 8_192)
    || !stringRecord(value.headers, 64) || !text(value.body, 2 * 1024 * 1024)) return false
  if (!input) return true
  return ['dev', 'staging', 'prod'].includes(String(value.environment))
    && text(value.baseUrl, 8_192)
    && (value.bearerToken === undefined || text(value.bearerToken, 16_384))
    && (value.variables === undefined || stringRecord(value.variables))
}

function validAssertion(value: unknown): boolean {
  if (!record(value)) return false
  if (value.kind === 'status') return value.operator === 'eq' && Number.isInteger(value.expected) && Number(value.expected) >= 100 && Number(value.expected) <= 599
  if (value.kind === 'latency') return value.operator === 'lt' && typeof value.expected === 'number' && Number.isFinite(value.expected) && value.expected > 0 && value.expected <= 300_000
  return value.kind === 'bodyIncludes' && value.operator === 'contains' && text(value.expected, 16_384)
}

function validScenario(value: unknown): value is ScenarioDefinition {
  return record(value) && id(value.id) && text(value.name, 256)
    && Array.isArray(value.steps) && value.steps.length <= 24
    && value.steps.every((step) => record(step) && id(step.id) && text(step.name, 256)
      && validRequest(step.request, true)
      && Array.isArray(step.assertions) && step.assertions.length <= 32 && step.assertions.every(validAssertion)
      && (step.extract === undefined || (record(step.extract) && id(step.extract.variable) && text(step.extract.path, 512))))
}

/** Deep, bounded validation used at both the renderer RPC and SQLite trust boundaries. */
export function parseWorkspace(value: unknown): WorkspaceState | null {
  if (!record(value) || value.version !== 1) return null
  if (!(value.activeRequestId === null || id(value.activeRequestId))) return null
  if (!Array.isArray(value.requests) || value.requests.length > 500 || !value.requests.every((item) => validRequest(item))) return null
  if (!Array.isArray(value.collections) || value.collections.length > 200 || !value.collections.every((item) => record(item)
    && id(item.id) && text(item.name, 256) && Array.isArray(item.requestIds) && item.requestIds.length <= 500 && item.requestIds.every(id))) return null
  if (!Array.isArray(value.environments) || value.environments.length > 16 || !value.environments.every((item) => record(item)
    && ['dev', 'staging', 'prod'].includes(String(item.name)) && text(item.baseUrl, 8_192))) return null
  if (!stringRecord(value.variables) || !Array.isArray(value.scenarios) || value.scenarios.length > 100 || !value.scenarios.every(validScenario)) return null
  if (!Array.isArray(value.importedDocuments) || value.importedDocuments.length > 32 || !value.importedDocuments.every((item) => record(item)
    && id(item.id) && ['openapi', 'postman'].includes(String(item.kind)) && text(item.title, 256)
    && text(item.importedAt, 64) && Number.isFinite(Date.parse(item.importedAt)) && text(item.raw, 2 * 1024 * 1024)
    && Array.isArray(item.requestIds) && item.requestIds.length <= 500 && item.requestIds.every(id))) return null
  if (!record(value.mock) || !['normal', 'delayed', 'error'].includes(String(value.mock.mode))
    || (value.mock.openApiDocumentId !== undefined && !id(value.mock.openApiDocumentId))) return null

  const workspace = value as unknown as WorkspaceState
  const requestIds = new Set(workspace.requests.map((item) => item.id))
  if (requestIds.size !== workspace.requests.length || (workspace.activeRequestId !== null && !requestIds.has(workspace.activeRequestId))) return null
  if (workspace.collections.some((item) => item.requestIds.some((requestId) => !requestIds.has(requestId)))) return null
  return workspace
}

export function normalizeWorkspace(value: unknown, fallback: WorkspaceState): WorkspaceState {
  return parseWorkspace(value) ?? fallback
}

export function hydrateWorkspace(serialized: string | undefined, fallback: WorkspaceState): WorkspaceState {
  if (!serialized) return fallback
  try {
    return normalizeWorkspace(JSON.parse(serialized) as unknown, fallback)
  } catch {
    return fallback
  }
}
