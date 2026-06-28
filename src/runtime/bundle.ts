// Generates the client-side JavaScript bundle that hydrates the WebView.
//
// We synthesize an entry that:
//   1. imports every page module (from src/app/.../page.tsx)
//   2. imports the root layout (if present)
//   3. wires hash-based routing
//   4. calls createRoot on #murasaki-root and re-renders on hashchange
//
// esbuild bundles the synthesized entry through the user's filesystem
// (resolveDir = projectRoot), pulling in murasaki/jsx/dom and the user's
// own code. The output is an IIFE that runs as soon as the <script> loads.

import * as esbuild from 'esbuild'
import { projectRoot } from '../env.ts'
import type { Route } from './routes.ts'

type BundleInput = {
  routes: Route[]
  rootLayoutFile: string | null
}

export async function bundleClient({ routes, rootLayoutFile }: BundleInput): Promise<string> {
  // Each route gets a numbered Page import so we can wire them by URL path.
  const pageImports = routes
    .map((r, i) => `import Page${i} from ${JSON.stringify(r.pageFile)}`)
    .join('\n')

  const layoutImport = rootLayoutFile
    ? `import RootLayout from ${JSON.stringify(rootLayoutFile)}`
    : ''

  // path → Page component map
  const routesMap = routes.map((r, i) => `  ${JSON.stringify(r.path)}: Page${i},`).join('\n')

  const wrap = rootLayoutFile ? 'jsx(RootLayout, { children: jsx(Page, null) })' : 'jsx(Page, null)'

  const entry = `
${pageImports}
${layoutImport}
import { createRoot, jsx } from 'murasaki/jsx/dom'

const ROUTES = {
${routesMap}
}

function currentPath() {
  const h = (typeof location !== 'undefined' && location.hash) || ''
  return h.startsWith('#') ? (h.slice(1) || '/') : '/'
}

const container = document.getElementById('murasaki-root')
if (!container) {
  throw new Error('[murasaki] mount point #murasaki-root not found')
}
container.textContent = ''

let _root
function render() {
  const path = currentPath()
  const Page = ROUTES[path] || ROUTES['/']
  if (!Page) {
    container.textContent = '404'
    return
  }
  const tree = ${wrap}
  if (!_root) _root = createRoot(container)
  _root.render(tree)
}

render()
window.addEventListener('hashchange', render)

// Intercept anchor clicks marked with data-murasaki-link
document.addEventListener('click', function (e) {
  let t = e.target
  while (t && t.nodeType === 1) {
    if (t.tagName === 'A' && t.hasAttribute('data-murasaki-link')) {
      e.preventDefault()
      const href = t.getAttribute('data-murasaki-link')
      if ('#' + href !== location.hash) location.hash = href
      else render()
      return
    }
    t = t.parentNode
  }
})
`

  const result = await esbuild.build({
    stdin: {
      contents: entry,
      loader: 'tsx',
      resolveDir: projectRoot,
      sourcefile: '<murasaki-client-entry>.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: ['safari16', 'chrome120', 'firefox120'],
    jsx: 'automatic',
    jsxImportSource: 'murasaki',
    minify: false,
    sourcemap: 'inline',
    logLevel: 'silent',
  })

  if (result.errors.length) {
    throw new Error(
      `[murasaki] client bundle failed:\n${result.errors.map((e) => e.text).join('\n')}`,
    )
  }

  return result.outputFiles[0].text
}
