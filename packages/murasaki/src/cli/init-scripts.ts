import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { MurasakiConfig } from '../config.js'

/**
 * `webview.initScripts`'s per-file and combined-total byte bounds. Enforced
 * here (not in `config.ts`'s `validateWebviewConfig`) because checking actual
 * file contents needs `node:fs`, and `config.ts` stays free of Node builtins
 * so it can be imported from renderer-reachable code — see the doc comment
 * above `resolveUpdater` in `config.ts`.
 */
const MAX_INIT_SCRIPT_BYTES = 256 * 1024
const MAX_TOTAL_INIT_SCRIPT_BYTES = 1024 * 1024

/**
 * Reads `webview.initScripts` (project-root-relative file paths) into file
 * contents, in declaration order, for both `murasaki dev`
 * (`cli/dev.ts`'s `createDevWindowTemplates`) and packaged builds
 * (`cli/bundle.ts`'s `metaJson`) — the same trusted JavaScript ends up
 * embedded in window metadata either way, following the same "resolve once
 * at dev/bundle time" pattern as other project-relative config paths (e.g.
 * `config.icon`).
 */
export function resolveInitScripts(
  config: Pick<MurasakiConfig, 'webview'>,
  cwd: string,
): string[] {
  const paths = config.webview?.initScripts
  if (!paths || paths.length === 0) return []
  let total = 0
  return paths.map((relativePath) => {
    const absolute = resolve(cwd, relativePath)
    let contents: string
    try {
      contents = readFileSync(absolute, 'utf8')
    } catch (error) {
      throw new Error(
        `murasaki: failed to read webview.initScripts entry ${JSON.stringify(relativePath)}: ${(error as Error).message}`,
      )
    }
    const byteLength = Buffer.byteLength(contents, 'utf8')
    if (byteLength > MAX_INIT_SCRIPT_BYTES) {
      throw new Error(
        `murasaki: webview.initScripts entry ${JSON.stringify(relativePath)} exceeds ${MAX_INIT_SCRIPT_BYTES} bytes`,
      )
    }
    total += byteLength
    if (total > MAX_TOTAL_INIT_SCRIPT_BYTES) {
      throw new Error(
        `murasaki: webview.initScripts total size exceeds ${MAX_TOTAL_INIT_SCRIPT_BYTES} bytes`,
      )
    }
    return contents
  })
}
