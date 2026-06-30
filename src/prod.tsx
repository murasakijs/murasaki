// src/prod.tsx — production boot.
// Same window + render path as dev, minus HMR and stdin shortcuts.
//
// User pages (src/app/*.tsx) are dynamic-imported at runtime. We import
// tsx/cjs statically here so the build step bundles it (instead of leaving
// it as an external require) — that way Node SEA can run the bundle
// because SEA's require only resolves built-in modules.
//
// Top-level await is wrapped in an async IIFE so the bundle compiles
// cleanly to CJS for Node SEA.

import 'tsx/cjs'
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
