// src/prod.tsx — production boot.
// Same window + render path as dev, minus HMR and stdin shortcuts.
//
// Note: we still register tsx/esm at startup because the user's pages
// (src/app/*.tsx) are dynamic-imported at runtime, not bundled. A real
// "static bundle of all pages" mode is a future optimization.

import 'tsx/esm'
import { printBanner, printReady, printStarting } from './cli/log.ts'
import { getConfig, openWindow, runApp } from './runtime/window.ts'

const startAt = Date.now()

await openWindow()
printBanner(getConfig().title, getConfig())
printStarting()
printReady(Date.now() - startAt)

runApp()
