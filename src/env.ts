// Project paths + version + platform — resolved once at boot.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = process.cwd()
export const SRC_DIR = join(projectRoot, 'src')
export const APP_PATH = join(SRC_DIR, 'app.tsx')
export const LAYOUT_PATH = join(SRC_DIR, 'layout.tsx')
export const GLOBALS_CSS = join(SRC_DIR, 'globals.css')

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
