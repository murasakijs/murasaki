import type { Connect, Plugin, ViteDevServer } from 'vite'
import type { ServerResponse } from 'node:http'
import { relative, resolve } from 'node:path'
import {
  MAX_WIRE_PAYLOAD_BYTES,
  parseWire,
  stringifyWire,
  WIRE_CONTENT_TYPE,
} from '../runtime/wire.js'

interface Options {
  srcDir: string
}

const MAIN_CALL_PREFIX = '/__murasaki/main/call/'
const WIRE_VIRTUAL_ID = 'virtual:murasaki/wire'

export function toMainModuleId(absPath: string): string {
  return relative(process.cwd(), absPath).replace(/\\/g, '/')
}

/** Turns a top-level `'use main'` module into typed renderer→Node RPC stubs. */
export function mainModulesPlugin({ srcDir }: Options): Plugin {
  return {
    name: 'murasaki:main-modules',
    enforce: 'pre',
    transform(code, id, options) {
      if (options?.ssr || !id.startsWith(srcDir)) return null
      if (!/^\s*(['"])use main\1\s*;?/m.test(code)) return null

      const moduleId = toMainModuleId(id)
      const stubs = extractExportNames(code).map((name) => `
export async function ${name}(...args) {
  const res = await fetch('${MAIN_CALL_PREFIX}${encodeURIComponent(moduleId)}/${name}', {
    method: 'POST',
    headers: { 'content-type': __murasakiWireContentType },
    body: await __murasakiStringifyWire({ args }),
  })
  let payload
  try { payload = __murasakiParseWire(await res.text()) }
  catch (cause) { throw new Error('Invalid main response (' + res.status + ')', { cause }) }
  if (!payload || typeof payload !== 'object' || typeof payload.ok !== 'boolean') {
    throw new Error('Invalid main response (' + res.status + ')')
  }
  if (!payload.ok) {
    if (payload.error instanceof Error) throw payload.error
    throw new Error(String(payload.error ?? 'main call failed: ' + res.status))
  }
  if (!res.ok) throw new Error('main call failed: ' + res.status)
  return payload.value
}`).join('\n')

      return {
        code: `// murasaki: use-main proxy
import { stringifyWire as __murasakiStringifyWire, parseWire as __murasakiParseWire, WIRE_CONTENT_TYPE as __murasakiWireContentType } from '${WIRE_VIRTUAL_ID}'
${stubs}
`,
        map: null,
      }
    },
    configureServer(server) {
      server.middlewares.use(handleMainCall(server))
    },
  }
}

function handleMainCall(server: ViteDevServer): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (req.method !== 'POST' || !req.url?.startsWith(MAIN_CALL_PREFIX)) return next()
    const rest = req.url.slice(MAIN_CALL_PREFIX.length)
    const separator = rest.lastIndexOf('/')
    if (separator === -1) return next()
    const id = resolve(process.cwd(), decodeURIComponent(rest.slice(0, separator)))
    const name = rest.slice(separator + 1)

    let args: unknown[]
    try {
      const parsed = parseWire(await readBody(req)) as { args?: unknown[] }
      if (!parsed || !Array.isArray(parsed.args)) throw new Error('missing "args" array')
      args = parsed.args
    } catch (error) {
      await sendResponse(res, 400, { ok: false, error: ensureError(error, 'Invalid main call') })
      return
    }

    try {
      const module = await server.ssrLoadModule(id)
      const fn = module[name]
      if (typeof fn !== 'function') {
        await sendResponse(res, 404, { ok: false, error: new Error(`No such main function: ${name}`) })
        return
      }
      await sendResponse(res, 200, { ok: true, value: await fn(...args) })
    } catch (error) {
      await sendResponse(res, 500, { ok: false, error: ensureError(error, 'Main call failed') })
    }
  }
}

async function sendResponse(res: ServerResponse, status: number, payload: unknown): Promise<void> {
  res.statusCode = status
  res.setHeader('content-type', WIRE_CONTENT_TYPE)
  res.setHeader('cache-control', 'no-store')
  try {
    res.end(await stringifyWire(payload))
  } catch (error) {
    res.statusCode = 500
    res.end(await stringifyWire({ ok: false, error: ensureError(error) }))
  }
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolveOk, rejectFail) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      const bytes = Buffer.from(chunk)
      size += bytes.byteLength
      if (size > MAX_WIRE_PAYLOAD_BYTES) {
        settled = true
        rejectFail(new Error(`Main payload exceeds ${MAX_WIRE_PAYLOAD_BYTES} bytes`))
        return
      }
      chunks.push(bytes)
    })
    req.on('end', () => { if (!settled) resolveOk(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', (error) => { if (!settled) rejectFail(error) })
  })
}

function ensureError(value: unknown, fallback = 'Main call failed'): Error {
  if (value instanceof Error) return value
  return new Error(value === undefined ? fallback : String(value), { cause: value })
}

function extractExportNames(source: string): string[] {
  const names = new Set<string>()
  const pattern = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) names.add(match[1] ?? match[2]!)
  return [...names]
}
