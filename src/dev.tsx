// src/dev.tsx
// Murasaki dev runner — Next.js-like file-based routing without Next.js.
//
// Reads the consumer's src/ directory:
//   src/layout.tsx   (optional, can export `metadata`)
//   src/app.tsx      (required)
//   src/globals.css  (optional, auto-injected)
//
// Renders <Layout><App /></Layout> with React, ships HTML to the WebView,
// and reloads in place on file change.

import {
  printBanner,
  printBye,
  printOpened,
  printReady,
  printShortcuts,
  printStarting,
} from './cli/log.ts'
import { setupHmr } from './runtime/hmr.ts'
import { setupShortcuts, teardownStdin } from './runtime/shortcuts.ts'
import {
  closeWindow,
  exitApp,
  getConfig,
  openWindow,
  reloadWindow,
  runApp,
} from './runtime/window.ts'

const startAt = Date.now()

// Boot: render once (applies metadata) → banner → ready
await openWindow()
printBanner(getConfig().title, getConfig())
printShortcuts()
printStarting()
printReady(Date.now() - startAt)

setupShortcuts({
  onOpen: () => {
    void openWindow().then(printOpened)
  },
  onRestart: () => {
    closeWindow()
    void openWindow().then(printOpened)
  },
  onQuit: () => {
    printBye()
    teardownStdin()
    exitApp()
    process.exit(0)
  },
})

setupHmr((file) => {
  void reloadWindow(file)
})

runApp()
