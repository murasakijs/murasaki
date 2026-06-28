// src/dev.tsx — boot entry for `murasaki dev`.

import {
  printBanner,
  printBye,
  printReady,
  printStarting,
} from './cli/log.ts'
import { setupHmr } from './runtime/hmr.ts'
import { setupShortcuts } from './runtime/shortcuts.ts'
import {
  closeWindow,
  exitApp,
  getConfig,
  openWindow,
  reloadWindow,
  runApp,
} from './runtime/window.ts'

const startAt = Date.now()

await openWindow()
printBanner(getConfig().title, getConfig())
printStarting()
printReady(Date.now() - startAt)

setupShortcuts({
  onOpen: () => {
    void openWindow()
  },
  onRestart: () => {
    closeWindow()
    void openWindow()
  },
  onQuit: () => {
    printBye()
    exitApp()
    process.exit(0)
  },
})

setupHmr((file) => {
  void reloadWindow(file)
})

runApp()
