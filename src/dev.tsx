// src/dev.tsx — boot entry for `murasaki dev`.

import { printBanner, printBye, printReady, printShortcuts, printStarting } from './cli/log.ts'
import { setupHmr } from './runtime/hmr.ts'
import { setupAppMenu } from './runtime/menu.ts'
import { setupShortcuts } from './runtime/shortcuts.ts'
import {
  app,
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
printShortcuts()
printStarting()
printReady(Date.now() - startAt)

const quit = () => {
  printBye()
  exitApp()
  process.exit(0)
}

// Native menu — Cmd+R reload, Cmd+Shift+R restart, Cmd+Q quit (built-in)
setupAppMenu(app, {
  onReload: () => {
    void reloadWindow('menu reload')
  },
  onRestart: () => {
    closeWindow()
    void openWindow()
  },
  onQuit: quit,
})

// Terminal single-key shortcuts (r / q) + signals.
setupShortcuts({
  onRestart: () => {
    closeWindow()
    void openWindow()
  },
  onQuit: quit,
})

setupHmr((file) => {
  void reloadWindow(file)
})

runApp()
