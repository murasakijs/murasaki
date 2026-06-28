// Multi-route renderer.
//
// Pipeline:
//   1. discover all src/app/<...>/page.tsx
//   2. render each page wrapped in its nested layouts (NOT the root layout)
//   3. render the root layout once with a switcher block as its children
//   4. inject metadata (<title>, <meta description>) + globals.css into <head>
//   5. inject a tiny navigation script that listens to hash changes and
//      intercepts <Link> clicks
//
// Legacy single-page (src/app.tsx + src/layout.tsx) is still supported:
// if src/app/ doesn't exist, we render the legacy convention.

import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  APP_DIR,
  APP_GLOBALS_CSS,
  LEGACY_APP_PATH,
  LEGACY_GLOBALS_CSS,
  LEGACY_LAYOUT_PATH,
} from '../env.ts'
import type { Metadata } from '../index.ts'
import { jsx, raw, renderToString } from '../jsx/runtime.ts'
import type { Child, Component } from '../jsx/types.ts'
import type { RenderResult } from '../types.ts'
import { bundleClient } from './bundle.ts'
import { discoverRoutes, type Route } from './routes.ts'

const NO_APP_HTML =
  '<!doctype html><html><body style="font-family:system-ui;padding:40px;">' +
  '<h1 style="color:#A855F7">No app found</h1>' +
  '<p>Create <code>src/app/page.tsx</code> and the window will reload.</p></body></html>'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function dynImport(path: string) {
  const url = pathToFileURL(path).href + `?v=${Date.now()}`
  return import(url)
}

type Loaded = {
  default: Component
  metadata?: Metadata
}

async function loadModule(path: string): Promise<Loaded | null> {
  if (!existsSync(path)) return null
  const mod = await dynImport(path)
  if (!mod.default) return null
  return mod
}

// ── Page rendering ──────────────────────────────────────────────────
async function renderPageInner(route: Route, rootLayoutFile: string | null): Promise<string> {
  const pageMod = await loadModule(route.pageFile)
  if (!pageMod) return ''
  let tree: Child = jsx(pageMod.default, null)

  // Wrap in nested layouts, innermost first (i.e. skip root layout — it wraps everything later)
  // route.layoutFiles: outermost first → so iterate from end backwards excluding root
  const layoutsToApply = route.layoutFiles.filter((f) => f !== rootLayoutFile)
  // Apply from innermost (last in array) outward (first in array) so the
  // outer layout wraps the inner: <Outer><Inner><Page/></Inner></Outer>
  for (let i = layoutsToApply.length - 1; i >= 0; i--) {
    const layoutMod = await loadModule(layoutsToApply[i])
    if (!layoutMod) continue
    tree = jsx(layoutMod.default, { children: tree })
  }
  return renderToString(tree)
}

// ── Root layout + metadata ──────────────────────────────────────────
async function renderRootLayout(rootLayout: Loaded | null, body: Child): Promise<string> {
  if (!rootLayout) {
    // Fallback root if user didn't write src/app/layout.tsx
    const fallback = jsx('html', {
      lang: 'en',
      children: [
        jsx('head', { children: jsx('meta', { charSet: 'utf-8' }) }),
        jsx('body', { children: body }),
      ],
    })
    return renderToString(fallback)
  }
  const tree = jsx(rootLayout.default, { children: body })
  return renderToString(tree)
}

// ── Navigation script (injected once) ───────────────────────────────
const NAV_SCRIPT = `
<script>
(function(){
  function showRoute(path){
    var blocks=document.querySelectorAll('[data-murasaki-route]');
    var matched=false;
    for(var i=0;i<blocks.length;i++){
      var b=blocks[i];
      if(b.getAttribute('data-murasaki-route')===path){
        b.removeAttribute('hidden');matched=true;
      } else {
        b.setAttribute('hidden','');
      }
    }
    if(!matched){
      // fallback to "/"
      var root=document.querySelector('[data-murasaki-route="/"]');
      if(root)root.removeAttribute('hidden');
    }
    document.dispatchEvent(new CustomEvent('murasaki:navigate',{detail:{path:path}}));
  }
  function currentPath(){
    var h=location.hash||'';
    return h.charAt(0)==='#'?h.slice(1)||'/':'/'
  }
  window.addEventListener('hashchange',function(){showRoute(currentPath())});
  document.addEventListener('click',function(e){
    var t=e.target;
    while(t&&t.nodeType===1){
      if(t.tagName==='A'&&t.hasAttribute('data-murasaki-link')){
        e.preventDefault();
        var href=t.getAttribute('data-murasaki-link');
        if('#'+href!==location.hash){location.hash=href;}
        else{showRoute(href);}
        return;
      }
      t=t.parentNode;
    }
  });
  // Initial render
  showRoute(currentPath());
})();
</script>
`.trim()

// ── Globals.css discovery (app/ takes precedence over src/) ─────────
function loadGlobalsCss(): string {
  for (const p of [APP_GLOBALS_CSS, LEGACY_GLOBALS_CSS]) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, 'utf8')
      } catch {}
    }
  }
  return ''
}

// ── Head injection ──────────────────────────────────────────────────
function injectHead(html: string, metadata: Metadata | undefined, css: string): string {
  const headInjects: string[] = []
  if (metadata?.title && !/<title>.*?<\/title>/i.test(html)) {
    headInjects.push(`<title>${escapeHtml(metadata.title)}</title>`)
  }
  if (metadata?.description && !/<meta[^>]+name=["']description["']/i.test(html)) {
    headInjects.push(`<meta name="description" content="${escapeHtml(metadata.description)}">`)
  }
  if (css) {
    headInjects.push(`<style data-murasaki="globals.css">${css}</style>`)
  }
  if (!headInjects.length) return html
  const blob = headInjects.join('')
  if (html.includes('</head>')) return html.replace('</head>', blob + '</head>')
  return html.replace('<body', blob + '<body')
}

// ── Main entry ──────────────────────────────────────────────────────
export async function renderApp(): Promise<RenderResult> {
  // 1. Try app-router convention first
  if (existsSync(APP_DIR)) {
    return renderAppRouter()
  }
  // 2. Fall back to legacy single-page
  if (existsSync(LEGACY_APP_PATH)) {
    return renderLegacy()
  }
  return { html: NO_APP_HTML }
}

async function renderAppRouter(): Promise<RenderResult> {
  const routes = discoverRoutes(APP_DIR)
  if (routes.length === 0) return { html: NO_APP_HTML }

  // Identify root layout (src/app/layout.tsx) if any
  const rootLayoutPath = routes[0]?.layoutFiles[0]
  const rootLayoutFile =
    rootLayoutPath && rootLayoutPath.endsWith('/app/layout.tsx') ? rootLayoutPath : null
  const rootLayoutMod = rootLayoutFile ? await loadModule(rootLayoutFile) : null
  const metadata = rootLayoutMod?.metadata

  // 2. Server pre-render each page (gives a usable first paint before the
  //    client bundle boots — pre-hydration shell). Each block goes inside
  //    the mount root and is replaced by the client renderer on boot.
  const blocks: string[] = []
  for (const route of routes) {
    const inner = await renderPageInner(route, rootLayoutFile)
    blocks.push(`<div data-murasaki-route="${escapeHtml(route.path)}" hidden>${inner}</div>`)
  }

  // 3. Wrap the server-rendered content + nav script in the mount container.
  //    The client bundle will clear this container on boot and re-render
  //    interactively (useState/onClick actually fire after that).
  const mountInner = blocks.join('') + NAV_SCRIPT
  const mountRoot = `<div id="murasaki-root">${mountInner}</div>`

  // 4. Build + inline client bundle (esbuild, IIFE)
  let clientScript = ''
  try {
    const code = await bundleClient({ routes, rootLayoutFile })
    clientScript = `<script type="module" data-murasaki="client">${code}</script>`
  } catch (e: any) {
    // Render an inline error overlay so the WebView shows what broke
    const msg = escapeHtml(String(e?.message ?? e))
    clientScript = `<script>document.body.insertAdjacentHTML('beforeend','<pre style=\\'position:fixed;inset:0;background:#1a0a33;color:#A855F7;padding:24px;font-family:SF Mono,Menlo,monospace;font-size:13px;overflow:auto;z-index:9999\\'>client bundle failed:\\n${msg.replace(/[\\'\\\\]/g, '\\\\$&')}</pre>')</script>`
  }

  // 5. Render root layout with mount root + client script as children
  const bodyContent = await renderRootLayout(rootLayoutMod, raw(mountRoot + clientScript))
  let html = '<!doctype html>' + bodyContent

  // 6. Inject metadata + globals.css
  html = injectHead(html, metadata, loadGlobalsCss())

  return { html, metadata }
}

// ── Legacy single-page render (unchanged shape) ─────────────────────
async function renderLegacy(): Promise<RenderResult> {
  const pageMod = await loadModule(LEGACY_APP_PATH)
  if (!pageMod) return { html: NO_APP_HTML }
  const layoutMod = await loadModule(LEGACY_LAYOUT_PATH)
  const metadata = layoutMod?.metadata
  const body: Child = layoutMod
    ? jsx(layoutMod.default, { children: jsx(pageMod.default, null) })
    : jsx(pageMod.default, null)
  let html = '<!doctype html>' + renderToString(body)
  html = injectHead(html, metadata, loadGlobalsCss())
  return { html, metadata }
}
