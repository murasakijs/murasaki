import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateContentSecurityPolicy } from '../config.js'

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

// Prod-only renderer crash capture (assets/prod-server.mjs's
// /__murasaki/diagnostics/renderer-error). Dev keeps this a no-op — the
// DevErrorOverlay (src/react/error-overlay.tsx) owns dev UX for the same two
// listeners instead, gated the same way (process.env.NODE_ENV).
if (process.env.NODE_ENV === 'production') installRendererCrashReporting()

createRoot(document.getElementById('root')).render(
  h(StrictMode, null, h(ThemeProvider, null, h(AppRouter, { routes, middleware }))),
)

function installRendererCrashReporting() {
  const MAX_PAYLOAD_BYTES = 16 * 1024
  const RATE_LIMIT_PER_MINUTE = 10
  const RATE_WINDOW_MS = 60_000
  let windowStart = Date.now()
  let sentInWindow = 0

  function send(message, stack, source) {
    const now = Date.now()
    if (now - windowStart >= RATE_WINDOW_MS) {
      windowStart = now
      sentInWindow = 0
    }
    if (sentInWindow >= RATE_LIMIT_PER_MINUTE) return
    sentInWindow++

    let payload = {
      message: String(message).slice(0, 8_000),
      stack: typeof stack === 'string' ? stack.slice(0, 16_000) : undefined,
      source,
    }
    let body = JSON.stringify(payload)
    while (new TextEncoder().encode(body).byteLength > MAX_PAYLOAD_BYTES && payload.stack) {
      payload = { ...payload, stack: payload.stack.slice(0, Math.floor(payload.stack.length / 2)) }
      body = JSON.stringify(payload)
    }
    fetch('/__murasaki/diagnostics/renderer-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  }

  window.addEventListener('error', (event) => {
    const error = event.error
    send(
      error instanceof Error ? error.message : event.message,
      error instanceof Error ? error.stack : undefined,
      'error',
    )
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    send(
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
      'unhandledrejection',
    )
  })
}
`

// The framework-owned app shell ships as a plain asset (assets/app.html) —
// not compiled TS — sitting at the package root alongside dev-server.mjs /
// prod-server.mjs. This file compiles to dist/vite-plugin/shell.js, so two
// levels up from there lands back at the package root. Exported so
// cli/build.ts can stage it as a project-local entry — see the comment on
// `build.rollupOptions.input` there for why the plugin can't just point
// rollup at this path directly.
export const SHELL_HTML_PATH = fileURLToPath(new URL('../../assets/app.html', import.meta.url))

export const DEFAULT_PRODUCTION_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "form-action 'self'",
].join('; ')

export const DEFAULT_DEVELOPMENT_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  // Vite and React Refresh inject inline module preambles in development.
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  // React style props and Vite's CSS HMR both require inline styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "media-src 'self' blob: https:",
  // ws: is required by Vite HMR; https: and wss: keep remote-backed apps usable.
  "connect-src 'self' https: ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "form-action 'self'",
].join('; ')

export interface AppShellOptions {
  csp?: string | false
}

export function resolveContentSecurityPolicy(
  configured: string | false | undefined,
  command: 'serve' | 'build',
): string | false {
  validateContentSecurityPolicy(configured)
  if (configured === false) return false
  return configured ?? (command === 'serve' ? DEFAULT_DEVELOPMENT_CSP : DEFAULT_PRODUCTION_CSP)
}

export function applyContentSecurityPolicy(
  html: string,
  configured: string | false | undefined,
  command: 'serve' | 'build',
): string {
  const policy = resolveContentSecurityPolicy(configured, command)
  if (policy === false) return html

  const existing = findContentSecurityPolicyMetaTags(html)
  if (existing.length > 0) {
    if (configured !== undefined) {
      throw new TypeError(
        'security.csp conflicts with a Content-Security-Policy meta tag in index.html; configure the policy in one place',
      )
    }
    // Meta-delivered CSP only protects content that follows it. User-owned
    // documents keep ownership of their policy, but Murasaki moves every CSP
    // tag to the beginning of <head> so an earlier script/resource cannot run
    // outside that policy. Preserve multiple policies and their order because
    // browsers intentionally enforce them cumulatively.
    let withoutExisting = html
    for (const match of [...existing].reverse()) {
      withoutExisting = withoutExisting.slice(0, match.start) + withoutExisting.slice(match.end)
    }
    return insertAtHeadStart(withoutExisting, existing.map((match) => match.tag).join('\n    '))
  }

  const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy)}">`
  return insertAtHeadStart(html, tag)
}

function insertAtHeadStart(html: string, tag: string): string {
  const head = /<head\b[^>]*>/i
  if (head.test(html)) return html.replace(head, (opening) => `${opening}\n    ${tag}`)

  const document = /<html\b[^>]*>/i
  if (document.test(html)) {
    return html.replace(document, (opening) => `${opening}\n  <head>\n    ${tag}\n  </head>`)
  }
  return `<head>\n  ${tag}\n</head>\n${html}`
}

function findContentSecurityPolicyMetaTags(
  html: string,
): Array<{ tag: string; start: number; end: number }> {
  // Keep string offsets stable while hiding commented-out tags from the scan.
  const visible = html.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length))
  const matches: Array<{ tag: string; start: number; end: number }> = []
  const meta = /<meta\b[^>]*>/gi
  for (let match = meta.exec(visible); match; match = meta.exec(visible)) {
    if (!/\bhttp-equiv\s*=\s*(?:"\s*content-security-policy\s*"|'\s*content-security-policy\s*'|content-security-policy(?=\s|\/?>))/i.test(match[0])) {
      continue
    }
    matches.push({
      tag: html.slice(match.index, match.index + match[0].length),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return matches
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

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
 *
 * Escape hatch: if the project has its own `index.html`, murasaki steps
 * aside and lets Vite serve it (so an app scaffolded before this model, or a
 * power user who wants to customize the HTML head, keeps working). The
 * framework shell is only used when the project has no index.html of its own
 * — kept in sync with the same check in cli/build.ts.
 */
export function appShellPlugin(options: AppShellOptions = {}): Plugin {
  let userOwnsHtml = false
  let command: 'serve' | 'build' = 'serve'
  return {
    name: 'murasaki:app-shell',
    configResolved(config) {
      command = config.command
      // configResolved.root is authoritative after Vite has merged inline,
      // user, and plugin config. This also keeps configureServer correct when
      // Vite is launched from a monorepo root for a nested application.
      userOwnsHtml = existsSync(resolve(config.root, 'index.html'))
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return applyContentSecurityPolicy(html, options.csp, command)
      },
    },
    config(config) {
      // Only take over HTML (appType:'custom' disables Vite's own index.html
      // serving + SPA fallback) when the project has no index.html of its own.
      // The config hook runs before configResolved, so use the user/inline root
      // here for the early appType decision; configResolved refreshes it from
      // the fully-resolved root before configureServer runs.
      const root = resolve(config.root ?? process.cwd())
      userOwnsHtml = existsSync(resolve(root, 'index.html'))
      return userOwnsHtml ? {} : { appType: 'custom' }
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
      // If the project owns its HTML, leave dev serving to Vite entirely.
      if (userOwnsHtml) return
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
