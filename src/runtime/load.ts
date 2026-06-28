// Loads the user's src/app.tsx, src/layout.tsx, src/globals.css.
// Uses cache-busting dynamic import so file edits are picked up
// without restarting the Node process.

import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { APP_PATH, GLOBALS_CSS, LAYOUT_PATH } from '../env.ts'
import type { Metadata } from '../index.ts'
import type { LayoutModule, ReactComponent } from '../types.ts'

async function dynImport(path: string) {
  const url = pathToFileURL(path).href + `?v=${Date.now()}`
  return import(url)
}

export async function loadApp(): Promise<ReactComponent | null> {
  if (!existsSync(APP_PATH)) return null
  const mod = await dynImport(APP_PATH)
  return mod.default as ReactComponent
}

export async function loadLayout(): Promise<LayoutModule> {
  if (!existsSync(LAYOUT_PATH)) return null
  const mod = await dynImport(LAYOUT_PATH)
  if (!mod.default) return null
  return {
    component: mod.default as ReactComponent,
    metadata: mod.metadata as Metadata | undefined,
  }
}

export function loadGlobalsCss(): string {
  if (!existsSync(GLOBALS_CSS)) return ''
  try {
    return readFileSync(GLOBALS_CSS, 'utf8')
  } catch {
    return ''
  }
}
