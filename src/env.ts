// Project paths + version + platform — resolved once at boot.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = process.cwd()
export const SRC_DIR = join(projectRoot, 'src')

// App-router convention (new, preferred):
//   src/app/page.tsx       → "/"
//   src/app/layout.tsx     → root layout (html/head/body)
//   src/app/<sub>/page.tsx → "/<sub>"
//   src/app/globals.css    → auto-injected
export const APP_DIR = join(SRC_DIR, 'app')
export const APP_GLOBALS_CSS = join(APP_DIR, 'globals.css')

// Legacy single-page convention (still supported):
//   src/app.tsx + src/layout.tsx + src/globals.css
export const LEGACY_APP_PATH = join(SRC_DIR, 'app.tsx')
export const LEGACY_LAYOUT_PATH = join(SRC_DIR, 'layout.tsx')
export const LEGACY_GLOBALS_CSS = join(SRC_DIR, 'globals.css')

const __dirname = dirname(fileURLToPath(import.meta.url))
export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

export const WEBVIEW_ENGINE: string = (() => {
  switch (process.platform) {
    case 'darwin':
      return 'WKWebView (macOS)'
    case 'win32':
      return 'WebView2 (Windows)'
    case 'linux':
      return 'WebKitGTK (Linux)'
    default:
      return `OS native (${process.platform})`
  }
})()

export const DEFAULT_WIN_TITLE = 'Murasaki App'
export const DEFAULT_WIN_SIZE = { width: 1280, height: 800 }
