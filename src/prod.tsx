// src/prod.tsx — production boot.
// Same window + render path as dev, minus HMR and stdin shortcuts.
//
// User pages are statically pre-bundled by `murasaki build`'s synthetic
// entry (see src/build.ts → buildSyntheticEntry), so we do NOT need to
// register tsx at runtime. That makes Node SEA happy.
//
// Top-level await is wrapped in an async IIFE so the bundle compiles
// cleanly to CJS for Node SEA.

import { printBanner, printReady, printStarting } from './cli/log.ts'
import { getConfig, openWindow, runApp } from './runtime/window.ts'

async function main() {
  const startAt = Date.now()
  await openWindow()
  printBanner(getConfig().title, getConfig())
  printStarting()
  printReady(Date.now() - startAt)
  runApp()
}

void main()
