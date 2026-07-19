import type { Assertion, ImportedWorkspace, RequestDraft, ResponseRecord } from './types.ts'

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

export function interpolate(input: string, variables: Record<string, string>): string {
  return input.replace(/\{\{([A-Za-z_][\w.-]*)\}\}|\$\{([A-Za-z_][\w.-]*)\}/g, (_match, a, b) => {
    const key = String(a ?? b)
    return Object.hasOwn(variables, key) ? variables[key]! : `{{${key}}}`
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { throw new Error('The imported document is not valid JSON.') }
}

function requestId(index: number) {
  return `imported-${index + 1}`
}

export function parseOpenApi(text: string): ImportedWorkspace {
  const root = asRecord(parseJson(text))
  const info = asRecord(root.info)
  const servers = Array.isArray(root.servers) ? root.servers : []
  const firstServer = asRecord(servers[0]).url
  const baseUrl = typeof firstServer === 'string' ? firstServer : ''
  const requests: RequestDraft[] = []
  for (const [path, pathValue] of Object.entries(asRecord(root.paths))) {
    for (const [method, operationValue] of Object.entries(asRecord(pathValue))) {
      if (!methods.has(method.toLowerCase())) continue
      const operation = asRecord(operationValue)
      requests.push({
        id: requestId(requests.length),
        name: typeof operation.summary === 'string' ? operation.summary : `${method.toUpperCase()} ${path}`,
        protocol: 'REST',
        method: method.toUpperCase(),
        url: `${baseUrl}${path}`,
        headers: { Accept: 'application/json' },
        body: operation.requestBody ? '{\n  \n}' : '',
      })
    }
  }
  if (!requests.length) throw new Error('No OpenAPI operations were found. Import an OpenAPI JSON document.')
  return {
    kind: 'openapi',
    title: typeof info.title === 'string' ? info.title : 'Imported OpenAPI',
    requests,
    variables: baseUrl ? { baseUrl } : {},
  }
}

function postmanHeaders(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {}
  return Object.fromEntries(value.flatMap((entry) => {
    const row = asRecord(entry)
    return typeof row.key === 'string' && typeof row.value === 'string' ? [[row.key, row.value]] : []
  }))
}

function walkPostman(items: unknown[], requests: RequestDraft[]) {
  for (const rawItem of items) {
    const item = asRecord(rawItem)
    if (Array.isArray(item.item)) {
      walkPostman(item.item, requests)
      continue
    }
    const request = asRecord(item.request)
    if (!Object.keys(request).length) continue
    const urlValue = request.url
    const url = typeof urlValue === 'string'
      ? urlValue
      : typeof asRecord(urlValue).raw === 'string' ? String(asRecord(urlValue).raw) : ''
    const body = asRecord(request.body)
    requests.push({
      id: requestId(requests.length),
      name: typeof item.name === 'string' ? item.name : `Request ${requests.length + 1}`,
      protocol: 'REST',
      method: typeof request.method === 'string' ? request.method.toUpperCase() : 'GET',
      url,
      headers: postmanHeaders(request.header),
      body: typeof body.raw === 'string' ? body.raw : '',
    })
  }
}

export function parsePostman(text: string): ImportedWorkspace {
  const root = asRecord(parseJson(text))
  const requests: RequestDraft[] = []
  walkPostman(Array.isArray(root.item) ? root.item : [], requests)
  if (!requests.length) throw new Error('No Postman requests were found.')
  const variables = Object.fromEntries((Array.isArray(root.variable) ? root.variable : []).flatMap((entry) => {
    const row = asRecord(entry)
    return typeof row.key === 'string' && typeof row.value === 'string' ? [[row.key, row.value]] : []
  }))
  const info = asRecord(root.info)
  return {
    kind: 'postman',
    title: typeof info.name === 'string' ? info.name : 'Imported Postman collection',
    requests,
    variables,
  }
}

export function parseImport(text: string): ImportedWorkspace {
  const root = asRecord(parseJson(text))
  if (typeof root.openapi === 'string' || typeof root.swagger === 'string') return parseOpenApi(text)
  if (root.info && root.item) return parsePostman(text)
  throw new Error('Supported formats are OpenAPI JSON and Postman Collection v2 JSON.')
}

export function readJsonPath(body: string, path: string): string | undefined {
  try {
    let current: unknown = JSON.parse(body)
    for (const segment of path.replace(/^\$\.?/, '').split('.').filter(Boolean)) {
      if (current === null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[segment]
    }
    return current === undefined ? undefined : String(current)
  } catch { return undefined }
}

export function evaluateAssertion(assertion: Assertion, response: ResponseRecord) {
  if (assertion.kind === 'status') {
    return { label: `status = ${assertion.expected}`, passed: response.status === assertion.expected }
  }
  if (assertion.kind === 'latency') {
    return { label: `latency < ${assertion.expected} ms`, passed: response.latencyMs < assertion.expected }
  }
  return { label: `body contains ${assertion.expected}`, passed: response.body.includes(assertion.expected) }
}
