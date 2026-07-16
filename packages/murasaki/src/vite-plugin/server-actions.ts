import type { Connect, Plugin, ViteDevServer } from 'vite'
import type { ServerResponse } from 'node:http'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_WIRE_PAYLOAD_BYTES,
  parseWire,
  stringifyWire,
  WIRE_CONTENT_TYPE,
} from '../runtime/wire.js'

interface Options {
  srcDir: string
}

const ACTION_PATH_PREFIX = '/__murasaki/action/'
const WIRE_VIRTUAL_ID = 'virtual:murasaki/wire'
const wireModulePath = resolve(dirname(fileURLToPath(import.meta.url)), '../runtime/wire.js')

/**
 * Stable id for a `'use server'` module: a project-root-relative POSIX path
 * (e.g. `src/api/actions.ts`). This is what the client stub embeds in its
 * `fetch()` call and what both the dev middleware (below) and the prod
 * server (assets/prod-server.mjs, keyed off the registry built by
 * cli/build-server.ts) use to look the module back up — it has to be
 * identical in dev and prod, so an absolute filesystem path (which used to
 * be used here) doesn't work since it's dev-machine-specific and wouldn't
 * match a module bundled into a prod registry anyway.
 */
export function toActionId(absPath: string): string {
  return relative(process.cwd(), absPath).replace(/\\/g, '/')
}

/**
 * Detects `'use server'` at the top of a module and splits it:
 *  - the client bundle gets a `fetch('/__murasaki/action/…')` proxy
 *  - the server keeps the real implementation (the SSR transform is left
 *    untouched so `server.ssrLoadModule` can load the actual functions)
 *
 * In dev, a middleware handles the `fetch` calls emitted by the stub and
 * invokes the real function via `ssrLoadModule`. In prod, the same stub
 * hits a Node HTTP server (assets/prod-server.mjs) backed by a registry
 * bundle built ahead of time by cli/build-server.ts.
 *
 * Full RSC parity lands in Phase B — Phase A ships the wire format so the
 * public shape is stable from day one.
 */
export function serverActionsPlugin({ srcDir }: Options): Plugin {
  return {
    name: 'murasaki:server-actions',
    enforce: 'pre',
    resolveId(id) {
      if (id === WIRE_VIRTUAL_ID) return wireModulePath
      return null
    },
    async transform(code, id, options) {
      if (options?.ssr) return null
      if (!id.startsWith(srcDir)) return null
      if (!/^\s*(['"])use server\1\s*;?/m.test(code)) return null

      const actionId = toActionId(id)
      const exports = extractExportNames(code)
      const stubs = exports
        .map(
          (name) => `export async function ${name}(...args) {
  const res = await fetch('/__murasaki/action/${encodeURIComponent(actionId)}/${name}', {
    method: 'POST',
    headers: { 'content-type': __murasakiWireContentType },
    body: await __murasakiStringifyWire({ args }),
  })
  let payload
  try {
    payload = __murasakiParseWire(await res.text())
  } catch (cause) {
    throw new Error('Invalid server action response (' + res.status + ')', { cause })
  }
  if (!payload || typeof payload !== 'object' || typeof payload.ok !== 'boolean') {
    throw new Error('Invalid server action response (' + res.status + ')')
  }
  if (!payload.ok) {
    if (payload.error instanceof Error) throw payload.error
    throw new Error(String(payload.error ?? 'server action failed: ' + res.status))
  }
  if (!res.ok) throw new Error('server action failed: ' + res.status)
  return payload.value
}`,
        )
        .join('\n')

      return {
        code: `// murasaki: use-server proxy
import { stringifyWire as __murasakiStringifyWire, parseWire as __murasakiParseWire, WIRE_CONTENT_TYPE as __murasakiWireContentType } from '${WIRE_VIRTUAL_ID}'
${stubs}
`,
        map: null,
      }
    },
    configureServer(server) {
      server.middlewares.use(handleActionRequest(server))
    },
  }
}

function handleActionRequest(server: ViteDevServer): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (req.method !== 'POST' || !req.url?.startsWith(ACTION_PATH_PREFIX)) {
      return next()
    }

    const rest = req.url.slice(ACTION_PATH_PREFIX.length)
    const sepIndex = rest.lastIndexOf('/')
    if (sepIndex === -1) return next()

    const encodedId = rest.slice(0, sepIndex)
    const name = rest.slice(sepIndex + 1)
    // The client sent back the project-root-relative id (see toActionId
    // above) — resolve it to the absolute path ssrLoadModule needs.
    const id = resolve(process.cwd(), decodeURIComponent(encodedId))

    let args: unknown[]
    try {
      const body = await readBody(req)
      const parsed = parseWire(body)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { args?: unknown }).args)) {
        throw new Error('missing "args" array')
      }
      args = (parsed as { args: unknown[] }).args
    } catch (err) {
      await sendWireResponse(res, 400, { ok: false, error: ensureError(err, 'Invalid request body') })
      return
    }

    try {
      const mod = await server.ssrLoadModule(id)
      const fn = mod[name]
      if (typeof fn !== 'function') {
        await sendWireResponse(res, 404, {
          ok: false,
          error: new Error(`No such server action: ${name}`),
        })
        return
      }

      const result = await fn(...args)
      await sendWireResponse(res, 200, { ok: true, value: result })
    } catch (err) {
      await sendWireResponse(res, 500, { ok: false, error: ensureError(err) })
    }
  }
}

async function sendWireResponse(
  res: ServerResponse,
  status: number,
  payload: unknown,
): Promise<void> {
  res.statusCode = status
  res.setHeader('content-type', WIRE_CONTENT_TYPE)
  res.setHeader('cache-control', 'no-store')
  try {
    res.end(await stringifyWire(payload))
  } catch (err) {
    res.statusCode = 500
    res.end(await stringifyWire({ ok: false, error: ensureError(err, 'Failed to encode action response') }))
  }
}

function ensureError(value: unknown, fallback = 'Server action failed'): Error {
  if (value instanceof Error) return value
  const error = new Error(value === undefined ? fallback : String(value))
  Object.defineProperty(error, 'cause', { value, enumerable: false, configurable: true })
  return error
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
      size += bytes.byteLength
      if (size > MAX_WIRE_PAYLOAD_BYTES) {
        settled = true
        reject(new Error(`Action payload exceeds ${MAX_WIRE_PAYLOAD_BYTES} bytes`))
        return
      }
      chunks.push(bytes)
    })
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (error) => {
      if (!settled) reject(error)
    })
  })
}

function extractExportNames(source: string): string[] {
  const names = new Set<string>()
  const re =
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    names.add(m[1] ?? m[2]!)
  }
  return [...names]
}
