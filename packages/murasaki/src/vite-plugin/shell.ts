import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const CLIENT_VIRTUAL_ID = 'virtual:murasaki/client'
const CLIENT_RESOLVED_ID = `\0${CLIENT_VIRTUAL_ID}`

// Written without JSX (plain `createElement`) so no JSX transform is needed
// on a virtual module — kept in sync with what the old template's
// `src/main.tsx` used to do by hand.
const CLIENT_ENTRY_SOURCE = `import { StrictMode, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter, installClientRpc, ThemeProvider } from 'murasaki'
import { routes, middleware } from 'virtual:murasaki/routes'

installClientRpc()

createRoot(document.getElementById('root')).render(
  h(StrictMode, null, h(ThemeProvider, null, h(AppRouter, { routes, middleware }))),
)
`

// The framework-owned app shell ships as a plain asset (assets/app.html) —
// not compiled TS — sitting at the package root alongside dev-server.mjs /
// prod-server.mjs. This file compiles to dist/vite-plugin/shell.js, so two
// levels up from there lands back at the package root. Exported so
// cli/build.ts can stage it as a project-local entry — see the comment on
// `build.rollupOptions.input` there for why the plugin can't just point
// rollup at this path directly.
export const SHELL_HTML_PATH = fileURLToPath(new URL('../../assets/app.html', import.meta.url))

/**
 * Framework-owned app shell (the Next.js model): user projects no longer
 * ship `index.html` or `src/main.tsx`. This plugin provides:
 *
 *  - `virtual:murasaki/client` — the createRoot bootstrap that `assets/app.html`
 *    points its `<script>` at.
 *  - dev: serves `assets/app.html` for HTML navigations. Requires
 *    `appType: 'custom'` (set below) to disable Vite's own index.html
 *    lookup/SPA-fallback so this plugin is the sole source of HTML.
 *
 * The build's HTML entry is wired separately, in cli/build.ts — Rollup's
 * html handling resolves an entry's emitted file name from its path
 * relative to `root`, ignoring any object-form input key, so an entry
 * living outside `root` (this shell ships inside the murasaki package, not
 * the user project) can't be pointed at directly here.
 */
export function appShellPlugin(): Plugin {
  return {
    name: 'murasaki:app-shell',
    config() {
      return {
        appType: 'custom',
      }
    },
    resolveId(id) {
      if (id === CLIENT_VIRTUAL_ID) return CLIENT_RESOLVED_ID
      return null
    },
    load(id) {
      if (id !== CLIENT_RESOLVED_ID) return null
      return CLIENT_ENTRY_SOURCE
    },
    configureServer(server) {
      // Returning a function here makes this a "post" hook: it runs after
      // Vite's own middlewares (transform pipeline, static/asset serving,
      // HMR websocket upgrade), so JS/CSS/HMR requests are handled first and
      // this only ever sees plain HTML navigations that fell through.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'GET') return next()
          const accept = req.headers.accept || ''
          if (!accept.includes('text/html')) return next()
          try {
            let html = await readFile(SHELL_HTML_PATH, 'utf8')
            html = await server.transformIndexHtml(req.originalUrl || req.url || '/', html)
            res.statusCode = 200
            res.setHeader('content-type', 'text/html')
            res.end(html)
          } catch (e) {
            next(e as Error)
          }
        })
      }
    },
  }
}
