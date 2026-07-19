export type Protocol = 'REST' | 'GraphQL' | 'WebSocket'
export type EnvironmentName = 'dev' | 'staging' | 'prod'
export type LogLevel = 'info' | 'warn' | 'error'
export type LogSource = 'HTTP' | 'APP' | 'DOCKER' | 'LOCAL' | 'WS'
export type MockMode = 'normal' | 'delayed' | 'error'
export type WorkspaceView = 'request' | 'collections' | 'scenarios' | 'mock' | 'environments' | 'history' | 'settings'

export interface EnvironmentConfig {
  name: EnvironmentName
  baseUrl: string
}

export interface RequestDraft {
  id: string
  name: string
  protocol: Protocol
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

export interface RequestInput extends RequestDraft {
  environment: EnvironmentName
  baseUrl: string
  bearerToken?: string
  variables?: Record<string, string>
}

export interface ResponseRecord {
  requestId: string
  status: number
  statusText: string
  latencyMs: number
  sizeBytes: number
  headers: Record<string, string>
  body: string
  receivedAt: string
  ok: boolean
}

export interface TimelineEvent {
  id: number
  occurredAt: string
  level: LogLevel
  source: LogSource
  service: string
  requestId: string
  summary: string
  detail?: string
}

export type Assertion =
  | { kind: 'status'; operator: 'eq'; expected: number }
  | { kind: 'latency'; operator: 'lt'; expected: number }
  | { kind: 'bodyIncludes'; operator: 'contains'; expected: string }

export interface ScenarioStep {
  id: string
  name: string
  request: RequestInput
  assertions: Assertion[]
  extract?: { variable: string; path: string }
}

export interface ScenarioDefinition {
  id: string
  name: string
  steps: ScenarioStep[]
}

export interface CollectionDefinition {
  id: string
  name: string
  requestIds: string[]
}

export interface ImportedDocument {
  id: string
  kind: 'openapi' | 'postman'
  title: string
  importedAt: string
  raw: string
  requestIds: string[]
}

export interface WorkspaceState {
  version: 1
  activeRequestId: string | null
  requests: RequestDraft[]
  collections: CollectionDefinition[]
  environments: EnvironmentConfig[]
  variables: Record<string, string>
  scenarios: ScenarioDefinition[]
  importedDocuments: ImportedDocument[]
  mock: { mode: MockMode; openApiDocumentId?: string }
}

export interface RuntimeHealth {
  ready: boolean
  database: 'starting' | 'connected' | 'error'
  mock: 'starting' | 'running' | 'stopped' | 'error'
  message: string
}

export interface StreamStatus {
  connected: boolean
  connecting?: boolean
  message: string
  target?: string
}

export interface ScenarioResult {
  stepId: string
  name: string
  passed: boolean
  response?: ResponseRecord
  assertionResults: Array<{ label: string; passed: boolean }>
  error?: string
}

export interface RuntimeSnapshot {
  mockUrl: string
  mockMode: MockMode
  sampleData: boolean
  sqlitePath: string
  events: TimelineEvent[]
  health: RuntimeHealth
  workspace: WorkspaceState
  docker: StreamStatus
  localLog: StreamStatus
}

export interface ImportedWorkspace {
  kind: 'openapi' | 'postman'
  title: string
  requests: RequestDraft[]
  variables: Record<string, string>
}
