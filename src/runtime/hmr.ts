// File watcher for src/ — debounces multi-event saves and triggers reload.
//
// macOS note: Node's fs.watch wraps FSEvents, which keeps the libuv loop
// alive AND, observed in practice, somehow blocks the OS close button on
// the webview window from completing. We:
//   1. unref() the watcher so it doesn't prop the process up on its own
//   2. close() it explicitly on app/window close (via teardown)
// That keeps HMR responsive while letting the red close button work.

import { type FSWatcher, existsSync, watch } from 'node:fs'
import { printHint } from '../cli/log.ts'
import { SRC_DIR } from '../env.ts'

let activeWatcher: FSWatcher | null = null

export function setupHmr(onChange: (filename: string) => void): void {
  if (!existsSync(SRC_DIR)) {
    printHint('src/ directory not found — nothing to watch')
    return
  }
  let debounce: NodeJS.Timeout | null = null
  let lastFile = ''
  try {
    const w = watch(SRC_DIR, { recursive: true }, (_event, filename) => {
      if (!filename) return
      if (debounce) clearTimeout(debounce)
      lastFile = filename.toString()
      debounce = setTimeout(() => {
        onChange(lastFile)
      }, 80)
    })
    // Don't let the watcher alone keep the process alive — the Cocoa main
    // loop in @webviewjs/webview is the real keep-alive.
    w.unref?.()
    activeWatcher = w
  } catch (e: any) {
    printHint(`HMR watcher failed: ${e.message}`)
  }
}

export function teardownHmr(): void {
  if (activeWatcher) {
    try {
      activeWatcher.close()
    } catch {}
    activeWatcher = null
  }
}
