#!/usr/bin/env node
// Murasaki CLI entry point.
// Usage: murasaki dev

import 'tsx/esm' // Register the TS+JSX ESM loader (for the user's src/)
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cmd = process.argv[2]

if (cmd === 'dev') {
  process.env.MURASAKI_DEV = '1'
  // Prefer the compiled dist (used in published npm package),
  // fall back to src for in-repo workspace development.
  const distPath = resolve(__dirname, '..', 'dist', 'dev.js')
  const srcPath = resolve(__dirname, '..', 'src', 'dev.tsx')
  const target = existsSync(distPath) ? distPath : srcPath
  await import(pathToFileURL(target).href)
} else {
  process.stdout.write(`
Usage:
  murasaki dev    Start the development server (HMR)

`)
  process.exit(cmd ? 1 : 0)
}
