import { build as viteBuild } from 'vite'
import { builtinModules } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { type ApiRouteSource, scanApiRoutes } from '../vite-plugin/api-routes.js'
import { toActionId } from '../vite-plugin/server-actions.js'
import { viteLogger } from './brand.js'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'])
const USE_SERVER_RE = /^(['"])use server\1;?$/
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))

/**
 * Bundles every `'use server'` module under `srcDir` into a single Node ESM
 * "registry" (`dist/server/actions.mjs`), and every `src/api/**\/route.ts`
 * into a parallel routes registry (`dist/server/routes.mjs`), that
 * `assets/prod-server.mjs` loads at runtime to run actions/routes in
 * production — the prod counterpart of the dev middlewares'
 * `server.ssrLoadModule(id)` in vite-plugin/server-actions.ts and
 * vite-plugin/api-routes.ts.
 *
 * Both are found with a directory scan (like vite-plugin/routing.ts's route
 * scan) rather than by tracking what the client build's transform touches —
 * a scan doesn't depend on whether the client bundle's module graph happens
 * to reach a given file, so it can't miss one that got tree-shaken out of the
 * client chunk.
 */
export default async function buildServer(cwd: string, srcDir: string): Promise<void> {
  const outDir = resolve(cwd, 'dist/server')
  const actionModules = await scanServerActionModules(srcDir)
  const apiRoutes = await scanApiRoutes(join(srcDir, 'api'))

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const tmpRoot = await mkdtemp(join(tmpdir(), 'murasaki-server-'))
  try {
    const input: Record<string, string> = {}

    if (actionModules.length === 0) {
      // No server actions in this project — ship an empty registry so
      // prod-server.mjs always has something importable.
      await writeFile(join(outDir, 'actions.mjs'), 'export const registry = {}\n')
    } else {
      const entryPath = join(tmpRoot, 'actions-entry.js')
      await writeFile(entryPath, buildActionsEntrySource(actionModules))
      input.actions = entryPath
    }

    if (apiRoutes.length === 0) {
      // No API routes in this project — ship an empty table for the same
      // reason as the empty actions registry above.
      await writeFile(join(outDir, 'routes.mjs'), 'export const routes = []\n')
    } else {
      const entryPath = join(tmpRoot, 'routes-entry.js')
      await writeFile(entryPath, buildRoutesEntrySource(apiRoutes))
      input.routes = entryPath
    }

    if (Object.keys(input).length === 0) return

    await viteBuild({
      root: cwd,
      build: {
        ssr: true,
        outDir,
        emptyOutDir: false,
        rollupOptions: {
          input,
          output: { entryFileNames: '[name].mjs', format: 'es' },
          external: (id) => BUILTINS.has(id) || id.startsWith('node:'),
        },
      },
      ssr: {
        // Bundle the app's own deps into the registries — prod ships them
        // without the project's node_modules, only Node builtins (kept
        // external above) and @murasakijs/native (unrelated to either).
        noExternal: true,
      },
      logLevel: 'silent',
      customLogger: viteLogger(),
    })
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

function buildActionsEntrySource(modules: string[]): string {
  const imports: string[] = []
  const entries: string[] = []
  modules.forEach((absPath, i) => {
    const importName = `_m${i}`
    imports.push(`import * as ${importName} from ${JSON.stringify(absPath)}`)
    entries.push(`  ${JSON.stringify(toActionId(absPath))}: ${importName},`)
  })
  return `${imports.join('\n')}\nexport const registry = {\n${entries.join('\n')}\n}\n`
}

function buildRoutesEntrySource(routes: ApiRouteSource[]): string {
  const imports: string[] = []
  const entries: string[] = []
  routes.forEach((route, i) => {
    const importName = `_r${i}`
    imports.push(`import * as ${importName} from ${JSON.stringify(route.filePath)}`)
    entries.push(
      `  { pattern: ${JSON.stringify(route.pattern)}, regexSource: ${JSON.stringify(route.regexSource)}, paramNames: ${JSON.stringify(route.paramNames)}, handlers: ${importName} },`,
    )
  })
  return `${imports.join('\n')}\nexport const routes = [\n${entries.join('\n')}\n]\n`
}

async function scanServerActionModules(srcDir: string): Promise<string[]> {
  const acc: string[] = []
  if (!existsSync(srcDir)) return acc
  await walk(srcDir, acc)
  return acc
}

async function walk(dir: string, acc: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, acc)
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name)) && (await isServerActionFile(full))) {
      acc.push(full)
    }
  }
}

/** `'use server'` must be the module's first non-empty line — same rule React uses for its directive. */
async function isServerActionFile(file: string): Promise<boolean> {
  const code = await readFile(file, 'utf8')
  const firstLine = code.split('\n').find((line) => line.trim().length > 0)
  return firstLine !== undefined && USE_SERVER_RE.test(firstLine.trim())
}
