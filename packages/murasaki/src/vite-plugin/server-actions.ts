import type { Connect, Plugin, ViteDevServer } from 'vite'

interface Options {
  srcDir: string
}

const ACTION_PATH_PREFIX = '/__murasaki/action/'

/**
 * Detects `'use server'` at the top of a module and splits it:
 *  - the client bundle gets a `fetch('/__murasaki/action/…')` proxy
 *  - the server keeps the real implementation (the SSR transform is left
 *    untouched so `server.ssrLoadModule` can load the actual functions)
 *
 * In dev, a middleware handles the `fetch` calls emitted by the stub and
 * invokes the real function via `ssrLoadModule`.
 *
 * Full RSC parity lands in Phase B — Phase A ships the wire format so the
 * public shape is stable from day one.
 */
export function serverActionsPlugin({ srcDir }: Options): Plugin {
  return {
    name: 'murasaki:server-actions',
    enforce: 'pre',
    async transform(code, id, options) {
      if (options?.ssr) return null
      if (!id.startsWith(srcDir)) return null
      if (!/^\s*(['"])use server\1\s*;?/m.test(code)) return null

      const exports = extractExportNames(code)
      const stubs = exports
        .map(
          (name) => `export async function ${name}(...args) {
  const res = await fetch('/__murasaki/action/${encodeURIComponent(id)}/${name}', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
  })
  if (!res.ok) throw new Error('server action failed: ' + res.status)
  return res.json()
}`,
        )
        .join('\n')

      return {
        code: `// murasaki: use-server proxy\n${stubs}\n`,
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
    const id = decodeURIComponent(encodedId)

    let args: unknown[]
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body)
      if (!Array.isArray(parsed?.args)) throw new Error('missing "args" array')
      args = parsed.args
    } catch {
      res.statusCode = 400
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'invalid request body' }))
      return
    }

    try {
      const mod = await server.ssrLoadModule(id)
      const fn = mod[name]
      if (typeof fn !== 'function') {
        res.statusCode = 404
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: `no such server action: ${name}` }))
        return
      }

      const result = await fn(...args)
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(result))
    } catch (err) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: String((err as Error)?.message ?? err) }))
    }
  }
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
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
