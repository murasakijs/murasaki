// File watcher for src/ — debounces multi-event saves and triggers reload.

import { existsSync, watch } from 'node:fs'
import { printHint } from '../cli/log.ts'
import { SRC_DIR } from '../env.ts'

export function setupHmr(onChange: (filename: string) => void): void {
  if (!existsSync(SRC_DIR)) {
    printHint('src/ directory not found — nothing to watch')
    return
  }
  let debounce: NodeJS.Timeout | null = null
  let lastFile = ''
  try {
    watch(SRC_DIR, { recursive: true }, (_event, filename) => {
      if (!filename) return
      if (debounce) clearTimeout(debounce)
      lastFile = filename.toString()
      debounce = setTimeout(() => {
        onChange(lastFile)
      }, 80)
    })
  } catch (e: any) {
    printHint(`HMR watcher failed: ${e.message}`)
  }
}
