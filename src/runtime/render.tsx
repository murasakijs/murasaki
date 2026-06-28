// Renders <Layout><App /></Layout> to an HTML string and injects
// metadata (<title>, <meta description>) + src/globals.css.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RenderResult } from '../types.ts'
import { loadApp, loadGlobalsCss, loadLayout } from './load.ts'

const NO_APP_HTML =
  '<!doctype html><html><body style="font-family:system-ui;padding:40px;">' +
  '<h1 style="color:#A855F7">src/app.tsx not found</h1>' +
  '<p>Create one and the window will reload.</p></body></html>'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function renderApp(): Promise<RenderResult> {
  const App = await loadApp()
  if (!App) return { html: NO_APP_HTML }

  const layoutData = await loadLayout()
  const metadata = layoutData?.metadata
  const appEl = createElement(App)
  const tree = layoutData ? createElement(layoutData.component, null, appEl) : appEl
  let html = '<!doctype html>' + renderToStaticMarkup(tree)

  const headInjects: string[] = []
  if (metadata?.title && !/<title>.*?<\/title>/i.test(html)) {
    headInjects.push(`<title>${escapeHtml(metadata.title)}</title>`)
  }
  if (metadata?.description && !/<meta[^>]+name=["']description["']/i.test(html)) {
    headInjects.push(`<meta name="description" content="${escapeHtml(metadata.description)}">`)
  }

  const css = loadGlobalsCss()
  if (css) {
    headInjects.push(`<style data-murasaki="globals.css">${css}</style>`)
  }

  if (headInjects.length) {
    const blob = headInjects.join('')
    if (html.includes('</head>')) {
      html = html.replace('</head>', blob + '</head>')
    } else {
      html = html.replace('<body', blob + '<body')
    }
  }

  return { html, metadata }
}
