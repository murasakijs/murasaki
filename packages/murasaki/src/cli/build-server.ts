import { build as viteBuild, loadConfigFromFile, mergeAlias, normalizePath, type Plugin, type PluginOption, type UserConfig } from 'vite'
import { builtinModules } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { type ApiRouteSource, scanApiRoutes } from '../vite-plugin/api-routes.js'
import { toActionId } from '../vite-plugin/server-actions.js'
import { toMainModuleId } from '../vite-plugin/main-modules.js'
import type { MurasakiConfig } from '../config.js'
import { viteLogger } from './brand.js'
import {
  packageNameFromImport,
  SERVER_DEPENDENCIES_MANIFEST,
  type ServerDependenciesManifest,
} from './server-dependencies.js'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'])
const USE_SERVER_RE = /^(['"])use server\1;?$/
const USE_MAIN_RE = /^(['"])use main\1;?$/
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))
const FRAMEWORK_PACKAGES = new Set(['murasaki', '@murasakijs/ui'])

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
export default async function buildServer(
  cwd: string,
  srcDir: string,
  config: MurasakiConfig,
): Promise<void> {
  const outDir = resolve(cwd, 'dist/server')
  const actionModules = await scanServerActionModules(srcDir)
  const mainModules = await scanDirectiveModules(srcDir, USE_MAIN_RE)
  // Vite canonicalizes symlinked roots (macOS /var -> /private/var), while
  // the source scanner retains the caller's spelling. Track both so the
  // directive transform recognizes the same physical module in either form.
  const mainModuleSet = new Set(
    mainModules.flatMap((path) => [path, realpathSync(path)]).map(canonicalModulePath),
  )
  const apiRoutes = await scanApiRoutes(join(srcDir, 'api'))
  const mainEntry = config.main === false
    ? null
    : resolve(cwd, config.main?.entry ?? 'src/main.ts')
  const runtimeDependencies = new Set(config.bundle?.external ?? [])
  const bundledDependencies = new Set([
    ...FRAMEWORK_PACKAGES,
    ...(config.bundle?.noExternal ?? []),
  ])
  const appViteConfig = await loadServerViteConfig(cwd)
  appViteConfig.resolve = {
    ...appViteConfig.resolve,
    // `murasaki:core` normally contributes this alias through its config()
    // hook. The private server build excludes Murasaki's client/dev plugins,
    // so reproduce the framework-owned alias explicitly.
    alias: mergeAlias(appViteConfig.resolve?.alias, { '@': srcDir }),
  }

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
      await writeFile(entryPath, buildActionsEntrySource(actionModules, cwd))
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

    if (mainModules.length === 0) {
      await writeFile(join(outDir, 'main-actions.mjs'), 'export const registry = {}\n')
    } else {
      const entryPath = join(tmpRoot, 'main-actions-entry.js')
      await writeFile(
        entryPath,
        buildRegistryEntrySource(mainModules, (path) => toMainModuleId(path, cwd)),
      )
      input['main-actions'] = entryPath
    }

    if (mainEntry && existsSync(mainEntry)) {
      input.main = mainEntry
    } else {
      await writeFile(join(outDir, 'main.mjs'), 'export default {}\n')
    }

    if (Object.keys(input).length > 0) {
      await viteBuild({
        // This is an internal SSR registry build, not the application's client
        // build. Loading vite.config.* here merges client-only plugins and
        // rollup output (for example manualChunks) into the server build and
        // can make an otherwise valid app impossible to bundle.
        configFile: false,
        root: cwd,
        // Preserve resolution and transforms the application's server code
        // relies on, while deliberately excluding client output/chunking and
        // Murasaki's own client/dev plugins from this private registry build.
        ...appViteConfig,
        plugins: [
          ...(appViteConfig.plugins ?? []),
          stripMainModuleDirectivesPlugin(mainModuleSet),
        ],
        build: {
          ssr: true,
          outDir,
          emptyOutDir: false,
          rollupOptions: {
            input,
            output: { entryFileNames: '[name].mjs', format: 'es' },
            external: (id) => {
              if (BUILTINS.has(id) || id.startsWith('node:')) return true
              // Rollup asks `external` before Vite's alias plugin resolves the
              // id. Never classify a configured alias (or a conventional
              // virtual module) as an npm runtime dependency at this stage.
              if (matchesConfiguredAlias(id, appViteConfig.resolve?.alias) || id.startsWith('virtual:') || id.startsWith('\0')) return false
              const packageName = packageNameFromImport(id)
              if (!packageName || bundledDependencies.has(packageName)) return false
              runtimeDependencies.add(packageName)
              return true
            },
          },
        },
        ssr: {
          // Framework helpers are compiled into the registries. App runtime
          // packages remain external and are staged with their native
          // add-ons/data files by bundle.ts (see server-dependencies.ts).
          noExternal: true,
        },
        logLevel: 'silent',
        customLogger: viteLogger(),
      })
    }

    const dependencyManifest: ServerDependenciesManifest = {
      version: 1,
      dependencies: [...runtimeDependencies].sort(),
    }
    await writeFile(
      join(outDir, SERVER_DEPENDENCIES_MANIFEST),
      `${JSON.stringify(dependencyManifest, null, 2)}\n`,
    )
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

function matchesConfiguredAlias(id: string, aliases: unknown): boolean {
  if (!aliases) return false
  if (Array.isArray(aliases)) {
    return aliases.some((alias) => {
      if (!alias || typeof alias !== 'object' || !('find' in alias)) return false
      const find = alias.find
      return typeof find === 'string'
        ? id === find || id.startsWith(`${find}/`)
        : find instanceof RegExp && find.test(id)
    })
  }
  if (typeof aliases !== 'object') return false
  return Object.keys(aliases).some((find) => id === find || id.startsWith(`${find}/`))
}

/**
 * Load only the Vite settings that can affect source resolution/transforms in
 * application-owned server code. Importing the whole config would also merge
 * client-only Rollup output (notably `manualChunks`) into this multi-entry SSR
 * registry build. Murasaki's own plugins are excluded because this build
 * supplies its framework transforms explicitly; third-party/user plugins are
 * retained so aliases and server-safe virtual/transform modules still work.
 */
async function loadServerViteConfig(cwd: string): Promise<UserConfig> {
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production', isSsrBuild: true, isPreview: false },
    undefined,
    cwd,
    'silent',
    viteLogger(),
  )
  if (!loaded) return {}

  const user = loaded.config
  const plugins = (await flattenPlugins(user.plugins ?? []))
    .filter((plugin) => !plugin.name.startsWith('murasaki:'))

  return {
    plugins,
    resolve: user.resolve,
    define: user.define,
    esbuild: user.esbuild,
    json: user.json,
    assetsInclude: user.assetsInclude,
  }
}

async function flattenPlugins(options: PluginOption[]): Promise<Plugin[]> {
  const plugins: Plugin[] = []
  for (const option of options) {
    const resolved = await option
    if (!resolved) continue
    if (Array.isArray(resolved)) {
      plugins.push(...await flattenPlugins(resolved))
    } else {
      plugins.push(resolved)
    }
  }
  return plugins
}

function stripMainModuleDirectivesPlugin(mainModules: ReadonlySet<string>) {
  return {
    name: 'murasaki:strip-main-module-directives',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = canonicalModulePath(id.split('?', 1)[0])
      if (!mainModules.has(file)) return null
      const stripped = stripLeadingDirective(code, USE_MAIN_RE)
      return stripped === code ? null : { code: stripped, map: null }
    },
  }
}

/** Vite module ids always use forward slashes, including on Windows. */
function canonicalModulePath(path: string): string {
  const normalized = normalizePath(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Remove only the framework-owned directive after the scanner has classified
 * the module. Replacing it with spaces preserves line/column positions for
 * diagnostics and sourcemaps while preventing Rollup from treating it as an
 * unsupported module-level runtime directive.
 */
export function stripLeadingMainDirective(code: string): string {
  return stripLeadingDirective(code, USE_MAIN_RE)
}

function stripLeadingDirective(code: string, directive: RegExp): string {
  let offset = 0
  for (const line of code.split(/(?<=\n)/)) {
    const withoutNewline = line.endsWith('\n') ? line.slice(0, -1) : line
    const trimmed = withoutNewline.trim()
    if (trimmed.length === 0) {
      offset += line.length
      continue
    }
    if (!directive.test(trimmed)) return code
    const start = offset + withoutNewline.indexOf(trimmed)
    return code.slice(0, start) + ' '.repeat(trimmed.length) + code.slice(start + trimmed.length)
  }
  return code
}

function buildActionsEntrySource(modules: string[], projectRoot = process.cwd()): string {
  return buildRegistryEntrySource(modules, (path) => toActionId(path, projectRoot))
}

function buildRegistryEntrySource(modules: string[], toId: (path: string) => string): string {
  const imports: string[] = []
  const entries: string[] = []
  modules.forEach((absPath, i) => {
    const importName = `_m${i}`
    imports.push(`import * as ${importName} from ${JSON.stringify(absPath)}`)
    entries.push(`  ${JSON.stringify(toId(absPath))}: ${importName},`)
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
      `  { pattern: ${JSON.stringify(route.pattern)}, regexSource: ${JSON.stringify(route.regexSource)}, paramNames: ${JSON.stringify(route.paramNames)}, paramKinds: ${JSON.stringify(route.paramKinds)}, specificity: ${route.specificity}, handlers: ${importName} },`,
    )
  })
  return `${imports.join('\n')}\nexport const routes = [\n${entries.join('\n')}\n]\n`
}

async function scanServerActionModules(srcDir: string): Promise<string[]> {
  return scanDirectiveModules(srcDir, USE_SERVER_RE)
}

async function scanDirectiveModules(srcDir: string, directive: RegExp): Promise<string[]> {
  const acc: string[] = []
  if (!existsSync(srcDir)) return acc
  await walk(srcDir, acc, directive)
  return acc
}

async function walk(dir: string, acc: string[], directive: RegExp): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, acc, directive)
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name)) && (await hasDirective(full, directive))) {
      acc.push(full)
    }
  }
}

/** `'use server'` must be the module's first non-empty line — same rule React uses for its directive. */
async function isServerActionFile(file: string): Promise<boolean> {
  return hasDirective(file, USE_SERVER_RE)
}

async function hasDirective(file: string, directive: RegExp): Promise<boolean> {
  const code = await readFile(file, 'utf8')
  const firstLine = code.split('\n').find((line) => line.trim().length > 0)
  return firstLine !== undefined && directive.test(firstLine.trim())
}
