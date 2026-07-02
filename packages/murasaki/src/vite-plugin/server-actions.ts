import type { Plugin } from 'vite'

interface Options {
  srcDir: string
}

/**
 * Detects `'use server'` at the top of a module and splits it:
 *  - the client bundle gets a `fetch('/__murasaki/action/…')` proxy
 *  - the server bundle keeps the real implementation
 *
 * Full RSC parity lands in Phase B — Phase A ships the wire format so the
 * public shape is stable from day one.
 */
export function serverActionsPlugin({ srcDir }: Options): Plugin {
  return {
    name: 'murasaki:server-actions',
    enforce: 'pre',
    async transform(code, id) {
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
  }
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
