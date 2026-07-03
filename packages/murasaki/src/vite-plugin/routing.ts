import type { Plugin } from 'vite'
import { access, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

interface Options {
  srcDir: string
}

const VIRTUAL_ID = 'virtual:murasaki/routes'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

const MIDDLEWARE_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'mts']

/**
 * File-based routing over `src/app/**\/page.tsx`.
 *
 * Emits a virtual module with an array of route entries the React runtime
 * consumes. Matches Next.js App Router shape (page / layout / loading /
 * error / not-found / dynamic segments / group segments). Also exposes the
 * project's optional `src/middleware.{ts,js,...}` default export, if any.
 */
export function fileRouterPlugin({ srcDir }: Options): Plugin {
  return {
    name: 'murasaki:routing',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null
      const routes = await scanRoutes(join(srcDir, 'app'))
      const middlewareFile = await findMiddlewareFile(srcDir)
      return emitRoutesModule(routes, join(srcDir, 'app'), middlewareFile)
    },
    async handleHotUpdate(ctx) {
      const isRouteFile = ctx.file.includes('/app/')
      const isMiddlewareFile = MIDDLEWARE_EXTS.some(
        (ext) => ctx.file === join(srcDir, `middleware.${ext}`),
      )
      if (!isRouteFile && !isMiddlewareFile) return
      const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_ID)
      if (mod) ctx.server.moduleGraph.invalidateModule(mod)
    },
  }
}

/** First `src/middleware.{ts,tsx,js,jsx,mjs,mts}` found, if any. */
async function findMiddlewareFile(srcDir: string): Promise<string | undefined> {
  for (const ext of MIDDLEWARE_EXTS) {
    const file = join(srcDir, `middleware.${ext}`)
    try {
      await access(file)
      return file
    } catch {
      // try next extension
    }
  }
  return undefined
}

interface RouteEntry {
  urlPath: string
  isDynamic: boolean
  pageFile?: string
  layoutFile?: string
  loadingFile?: string
  errorFile?: string
  notFoundFile?: string
}

async function scanRoutes(appDir: string): Promise<RouteEntry[]> {
  const acc: RouteEntry[] = []
  try {
    await walk(appDir, appDir, [], acc)
  } catch {
    // src/app not present yet — return empty; user will get 404 by default.
  }
  return acc
}

async function walk(
  root: string,
  dir: string,
  urlSegments: string[],
  acc: RouteEntry[],
) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = new Map<string, string>()
  const subdirs: string[] = []
  for (const e of entries) {
    if (e.isDirectory()) subdirs.push(e.name)
    else files.set(e.name, join(dir, e.name))
  }

  const page = pick(files, 'page.tsx', 'page.ts', 'page.jsx', 'page.js')
  const layout = pick(files, 'layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js')
  const loading = pick(files, 'loading.tsx', 'loading.ts', 'loading.jsx', 'loading.js')
  const errorF = pick(files, 'error.tsx', 'error.ts', 'error.jsx', 'error.js')
  const notFound = pick(files, 'not-found.tsx', 'not-found.ts')

  if (page || layout || loading || errorF || notFound) {
    const urlPath = urlSegments
      .filter((s) => !isGroupSegment(s))
      .map(normalizeSegment)
      .join('/') || '/'
    acc.push({
      urlPath: urlPath.startsWith('/') ? urlPath : `/${urlPath}`,
      isDynamic: urlSegments.some(isDynamicSegment),
      pageFile: page,
      layoutFile: layout,
      loadingFile: loading,
      errorFile: errorF,
      notFoundFile: notFound,
    })
  }

  for (const sub of subdirs) {
    if (sub.startsWith('_')) continue
    await walk(root, join(dir, sub), [...urlSegments, sub], acc)
  }
}

function pick(files: Map<string, string>, ...names: string[]) {
  for (const n of names) {
    const f = files.get(n)
    if (f) return f
  }
  return undefined
}

function isGroupSegment(seg: string) {
  return seg.startsWith('(') && seg.endsWith(')')
}
function isDynamicSegment(seg: string) {
  return seg.startsWith('[') && seg.endsWith(']')
}
function normalizeSegment(seg: string) {
  if (isDynamicSegment(seg)) return `:${seg.slice(1, -1)}`
  return seg
}

function emitRoutesModule(
  routes: RouteEntry[],
  appDir: string,
  middlewareFile?: string,
): string {
  const imports: string[] = []
  const items: string[] = []
  routes.forEach((r, i) => {
    const bag: string[] = [`urlPath: ${JSON.stringify(r.urlPath)}`]
    bag.push(`isDynamic: ${r.isDynamic}`)
    const attach = (key: string, file?: string) => {
      if (!file) return
      const id = `_r${i}_${key}`
      imports.push(
        `import * as ${id} from '/${relative(process.cwd(), file).replace(/\\/g, '/')}'`,
      )
      bag.push(`${key}: ${id}`)
    }
    attach('page', r.pageFile)
    attach('layout', r.layoutFile)
    attach('loading', r.loadingFile)
    attach('error', r.errorFile)
    attach('notFound', r.notFoundFile)
    items.push(`{ ${bag.join(', ')} }`)
  })

  let middlewareExport = 'export const middleware = undefined'
  if (middlewareFile) {
    imports.push(
      `import _mw from '/${relative(process.cwd(), middlewareFile).replace(/\\/g, '/')}'`,
    )
    middlewareExport = 'export const middleware = _mw'
  }

  return `${imports.join('\n')}\nexport const routes = [${items.join(',')}]\nexport const appDir = ${JSON.stringify(appDir)}\n${middlewareExport}\n`
}
