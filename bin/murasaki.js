#!/usr/bin/env node
// Murasaki CLI entry point.
// Usage: murasaki dev

import 'tsx/esm' // Register the TS+JSX ESM loader
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cmd = process.argv[2]

if (cmd === 'dev') {
  process.env.MURASAKI_DEV = '1'
  const devPath = resolve(__dirname, '..', 'src', 'dev.tsx')
  await import(pathToFileURL(devPath).href)
} else {
  process.stdout.write(`
Usage:
  murasaki dev    Start the development server (HMR)

`)
  process.exit(cmd ? 1 : 0)
}
