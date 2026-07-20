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
  // Header-only: a browser ignores frame-ancestors in a <meta> tag, so this
  // only takes effect via the Content-Security-Policy response header (see
  // applyContentSecurityPolicy/stripHeaderOnlyDirectives below). Nothing
  // embeds a murasaki window in another document, so deny it outright.
  "frame-ancestors 'none'",
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
  // See the production policy's comment above: header-only, harmless (and
  // ignored) in the meta tag. Vite HMR doesn't use iframes, so denying
  // framing is consistent with production here too.
  "frame-ancestors 'none'",
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

// Directives the CSP spec requires delivery via the HTTP response header —
// a <meta http-equiv="Content-Security-Policy"> carrying them is silently
// ignored (frame-ancestors, sandbox) or unsupported by meta delivery
// (report-to/report-uri, which need a real response to attach a reporting
// endpoint to). resolveContentSecurityPolicy() is the single source of truth
// for the *header* policy; stripHeaderOnlyDirectives() derives the meta
// variant from it so the two consumers can never drift apart on the
// directives they share, while the meta tag doesn't carry directives it
// can't enforce (and that engines may warn about).
const HEADER_ONLY_DIRECTIVES = new Set([
  'frame-ancestors',
  'sandbox',
  'report-uri',
  'report-to',
])

/** Derives the meta-tag-safe policy from a resolved header policy — see `HEADER_ONLY_DIRECTIVES`. */
export function stripHeaderOnlyDirectives(policy: string): string {
  return policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => {
      const name = directive.split(/\s+/, 1)[0]?.toLowerCase()
      return !!name && !HEADER_ONLY_DIRECTIVES.has(name)
    })
    .join('; ')
}

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

/** True iff `html` declares its own (non-framework-owned) CSP meta tag — see `resolveHeaderContentSecurityPolicy`. */
export function htmlDeclaresUserContentSecurityPolicy(html: string): boolean {
  return findContentSecurityPolicyMetaTags(html).some((match) => !match.frameworkOwned)
}

/**
 * Resolves the `Content-Security-Policy` *response header* policy — the
 * single source of truth for both the dev middleware
 * (vite-plugin/runtime-security.ts) and the packaged app's bundle metadata
 * (cli/bundle.ts's `metaJson`), so the two never diverge.
 *
 * Delegates to `resolveContentSecurityPolicy` for the actual policy string in
 * every case except one: when `security.csp` is unconfigured and the
 * project's `index.html` declares its own CSP meta tag, `applyContentSecurityPolicy`
 * defers to that user-owned tag and injects none of its own (see the
 * `configured === undefined` branch there). Emitting the framework default as
 * a header in that case would still layer on top of the user's meta policy —
 * browsers enforce multiple CSPs cumulatively — silently tightening (and
 * likely breaking) a policy the user believed they fully controlled. This
 * returns `false` (no header at all) in exactly that case so the user's meta
 * tag remains the sole, authoritative policy.
 */
export function resolveHeaderContentSecurityPolicy(
  configured: string | false | undefined,
  command: 'serve' | 'build',
  indexHtml: string | null,
): string | false {
  if (configured === undefined && indexHtml !== null && htmlDeclaresUserContentSecurityPolicy(indexHtml)) {
    return false
  }
  return resolveContentSecurityPolicy(configured, command)
}

export function applyContentSecurityPolicy(
  html: string,
  configured: string | false | undefined,
  command: 'serve' | 'build',
): string {
  const policy = resolveContentSecurityPolicy(configured, command)
  if (policy === false) return html
  // The header (set by runtime-security.ts in dev and prod-server.mjs in
  // prod from this same resolved `policy`) carries the full policy;
  // header-only directives are stripped for the meta tag here — see
  // `HEADER_ONLY_DIRECTIVES`.
  const metaPolicy = stripHeaderOnlyDirectives(policy)

  const existing = findContentSecurityPolicyMetaTags(html)
  if (existing.length > 0) {
    if (configured !== undefined) {
      // Vite may run transformIndexHtml more than once for the same build
      // entry. A tag inserted by this function is therefore not a config
      // conflict on a later pass. Keep rejecting user-owned tags (including
      // a mixture of user- and framework-owned tags), since two independently
      // configured policies are enforced cumulatively by browsers and can
      // unexpectedly break an application.
      if (existing.length === 1 && existing[0].frameworkOwned) {
        const withoutExisting =
          html.slice(0, existing[0].start) + html.slice(existing[0].end)
        return insertAtHeadStart(withoutExisting, frameworkContentSecurityPolicyTag(metaPolicy))
      }
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

  return insertAtHeadStart(html, frameworkContentSecurityPolicyTag(metaPolicy))
}

function frameworkContentSecurityPolicyTag(policy: string): string {
  return `<meta data-murasaki-csp http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy)}">`
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
): Array<{ tag: string; start: number; end: number; frameworkOwned: boolean }> {
  // Keep string offsets stable while hiding commented-out tags from the scan.
  const visible = html.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length))
  const matches: Array<{ tag: string; start: number; end: number; frameworkOwned: boolean }> = []
  const meta = /<meta\b[^>]*>/gi
  for (let match = meta.exec(visible); match; match = meta.exec(visible)) {
    if (!/\bhttp-equiv\s*=\s*(?:"\s*content-security-policy\s*"|'\s*content-security-policy\s*'|content-security-policy(?=\s|\/?>))/i.test(match[0])) {
      continue
    }
    matches.push({
      tag: html.slice(match.index, match.index + match[0].length),
      start: match.index,
      end: match.index + match[0].length,
      frameworkOwned: /\bdata-murasaki-csp(?:\s*=\s*(?:""|''|data-murasaki-csp))?(?=\s|\/?>)/i.test(match[0]),
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
