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
import type { GlobalContextMenuItem } from './context-menu.ts'
import type { Route } from './routes.ts'

type BundleInput = {
  routes: Route[]
  rootLayoutFile: string | null
  /**
   * WebView chrome tweaks resolved from murasaki.config.ts.
   * Defaults trim browser-y affordances that don't belong in a native app.
   */
  webview?: {
    contextMenu?: false | 'browser' | GlobalContextMenuItem[]
    suppressBrowserShortcuts?: boolean
  }
}

export async function bundleClient({ routes, rootLayoutFile, webview }: BundleInput): Promise<string> {
  const contextMenu = webview?.contextMenu ?? false
  const suppressBrowserShortcuts = webview?.suppressBrowserShortcuts ?? true
  const contextMenuItems: GlobalContextMenuItem[] = Array.isArray(contextMenu) ? contextMenu : []
  const hasCustomContextMenu = contextMenuItems.length > 0
  const useBrowserContextMenu = contextMenu === 'browser'
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

  // Trim browser affordances that make a WebView app feel like a browser:
  // right-click context menu with Reload/Inspect, F5/Cmd+R page refresh,
  // drag-to-navigate, Cmd+L address bar, etc. Both are opt-outable via
  // murasaki.config.ts.
  //
  // Order of precedence for contextmenu:
  //   1. contextMenu: 'browser'         → leave the WebView default in place
  //   2. contextMenu: GlobalContextMenuItem[] → install murasaki's custom renderer
  //   3. contextMenu: false / omitted   → block preventDefault, no UI
  const chromeSuppressors = [
    useBrowserContextMenu || hasCustomContextMenu
      ? ''
      : "document.addEventListener('contextmenu', function(e){ e.preventDefault() }, true);",
    suppressBrowserShortcuts
      ? "document.addEventListener('keydown', function(e){" +
        "  var k = e.key;" +
        "  var mod = e.metaKey || e.ctrlKey;" +
        // Cmd+R / Ctrl+R / F5 / Cmd+Shift+R — reload
        "  if ((mod && (k === 'r' || k === 'R')) || k === 'F5') { e.preventDefault(); return }" +
        // Cmd+L — focus address bar
        "  if (mod && (k === 'l' || k === 'L')) { e.preventDefault(); return }" +
        // Cmd+D — bookmark
        "  if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); return }" +
        // Cmd+F is a legitimate app shortcut (search). Leave it alone.
        "}, true);"
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const contextMenuInstall = hasCustomContextMenu
    ? `import { installGlobalContextMenu } from 'murasaki/context-menu-client';
installGlobalContextMenu(${JSON.stringify(contextMenuItems)});`
    : ''

  const entry = `
${chromeSuppressors}
${pageImports}
${layoutImport}
import { createRoot, jsx } from 'murasaki/jsx/dom'
${contextMenuInstall}

// Inlined installClientRpc() — we can't import it via 'murasaki' because
// the package's main entry re-exports Node-only modules (config, env)
// that esbuild refuses to bundle for the browser target.
;(function installClientRpc() {
  if (typeof window === 'undefined' || window.__murasakiRpc__) return
  const pending = new Map()
  let counter = 0
  window.__murasakiRpc__ = {
    call(name, args) {
      return new Promise((resolve, reject) => {
        if (!window.ipc || !window.ipc.postMessage) {
          reject(new Error('[murasaki] window.ipc is not available'))
          return
        }
        const id = 'r' + (++counter)
        pending.set(id, { resolve, reject })
        window.ipc.postMessage(JSON.stringify({ kind: 'call', id: id, name: name, args: args }))
      })
    },
    resolve(id, value) {
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      p.resolve(value)
    },
    reject(id, err) {
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      p.reject(new Error(err))
    },
  }
})()

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

  // Any code path that reaches a Node built-in (`node:fs`, `node:path`, …)
  // is dead in the browser. murasaki's index re-exports server-only helpers
  // like defineConfig/loadConfig, which pull those in through config.ts and
  // env.ts. Rather than split the package into two entry points (and force
  // every consumer to change their imports), we replace `node:*` specifiers
  // with an empty ESM module — tree-shaking then discards the server-only
  // functions that used them, leaving only the components/hooks the client
  // actually calls.
  // Enumerated export names for the Node built-ins murasaki's server code
  // touches. These are the names esbuild's ESM/CJS interop pipeline copies
  // via getOwnPropertyNames; a Proxy alone doesn't expose named getters in
  // that iteration, so we materialise real properties on a stub function.
  const NODE_STUB_EXPORTS: Record<string, string[]> = {
    fs: [
      'readFileSync', 'writeFileSync', 'existsSync', 'mkdirSync', 'statSync',
      'lstatSync', 'readdirSync', 'unlinkSync', 'rmSync', 'renameSync',
      'chmodSync', 'cpSync', 'createReadStream', 'createWriteStream',
      'watch', 'promises', 'default',
    ],
    path: [
      'join', 'resolve', 'dirname', 'basename', 'extname', 'normalize',
      'relative', 'isAbsolute', 'parse', 'format', 'sep', 'delimiter',
      'posix', 'win32', 'default',
    ],
    url: [
      'pathToFileURL', 'fileURLToPath', 'URL', 'URLSearchParams',
      'format', 'parse', 'resolve', 'default',
    ],
    os: [
      'homedir', 'tmpdir', 'platform', 'arch', 'release', 'type',
      'cpus', 'freemem', 'totalmem', 'hostname', 'default',
    ],
    child_process: [
      'spawn', 'exec', 'execSync', 'spawnSync', 'fork', 'execFile',
      'execFileSync', 'default',
    ],
    module: ['createRequire', 'Module', 'default'],
    crypto: ['createHash', 'randomBytes', 'randomUUID', 'default'],
    events: ['EventEmitter', 'default'],
    stream: ['Readable', 'Writable', 'Transform', 'Duplex', 'default'],
    util: ['promisify', 'inherits', 'format', 'default'],
    process: ['default'],
  }
  const stubForBuiltin = (name: string): string => {
    const exports = NODE_STUB_EXPORTS[name] ?? ['default']
    // Build an object literal we can attach real getters onto, so
    // getOwnPropertyNames(stub) enumerates the names esbuild's interop
    // pipeline copies.
    return (
      'var noop = function(){}; ' +
      'var stub = {};' +
      exports.map((k) => `stub[${JSON.stringify(k)}] = noop;`).join(' ') +
      'stub.__esModule = true; ' +
      'module.exports = stub;'
    )
  }
  const stubNodeBuiltins: esbuild.Plugin = {
    name: 'murasaki-stub-node-builtins',
    setup(build) {
      build.onResolve({ filter: /^node:/ }, (args) => ({
        path: args.path,
        namespace: 'murasaki-node-stub',
      }))
      build.onLoad({ filter: /.*/, namespace: 'murasaki-node-stub' }, (args) => {
        const builtin = args.path.replace(/^node:/, '')
        return { contents: stubForBuiltin(builtin), loader: 'js' }
      })
    },
  }

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
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'murasaki',
    minify: false,
    sourcemap: 'inline',
    plugins: [stubNodeBuiltins],
    // A minimal `process` shim so bundled code that reads `process.env.*`
    // or dereferences `process.cwd()` / `process.platform` at module init
    // doesn't crash the entire hydration in the browser. The server-only
    // code paths that touch these are dead in the client, but ESM top-level
    // statements still execute before tree-shaking can help.
    banner: {
      js:
        'var process = typeof process !== "undefined" ? process : { ' +
        'env: { NODE_ENV: "production", MURASAKI_DEV: "0" }, ' +
        'versions: {}, platform: "browser", ' +
        'cwd: function(){ return "/" }, ' +
        'argv: [], ' +
        'nextTick: function(fn){ Promise.resolve().then(fn) } ' +
        '};',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      // Server-side branches like `typeof window === 'undefined'` become
      // dead code and get eliminated.
      'process.env.MURASAKI_DEV': '"0"',
    },
    logLevel: 'silent',
  })

  if (result.errors.length) {
    throw new Error(
      `[murasaki] client bundle failed:\n${result.errors.map((e) => e.text).join('\n')}`,
    )
  }

  // Wrap the IIFE with an outer try/catch so any exception thrown while the
  // static-imported modules initialise is written to a DOM attribute Node
  // can probe. WKWebView redacts inline-script exceptions to 'Script error.'
  // on window.onerror, which makes debugging otherwise impossible.
  const body = result.outputFiles[0].text
  return (
    'try{' +
    body +
    '}catch(__murasaki_boot_err){try{' +
    "document.body.setAttribute('data-murasaki-boot-error', " +
    'String((__murasaki_boot_err && __murasaki_boot_err.stack) || __murasaki_boot_err));' +
    "document.title='[BOOT-ERR] '+String(__murasaki_boot_err&&__murasaki_boot_err.message||__murasaki_boot_err);" +
    '}catch(__e){}}'
  )
}
