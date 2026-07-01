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
import { resolveAppMeta } from './config.ts'
import { setupAppMenu } from './runtime/menu.ts'
import { app, closeWindow, getConfig, openWindow, runApp } from './runtime/window.ts'

async function main() {
  const startAt = Date.now()
  await openWindow()

  // Wire up the native menu bar so the app menu / About dialog / Cmd+Q
  // all show the correct display name instead of falling back to "node".
  try {
    const meta = await resolveAppMeta()
    if (app) {
      setupAppMenu(
        app,
        {
          onReload: () => {},
          onRestart: () => {},
          onQuit: () => {
            try {
              closeWindow()
            } catch {}
          },
        },
        { appName: meta.name, includeDevMenu: false },
      )
    }
  } catch {}

  printBanner(getConfig().title, getConfig())
  printStarting()
  printReady(Date.now() - startAt)
  runApp()
}

void main()
