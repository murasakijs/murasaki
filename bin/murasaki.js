#!/usr/bin/env node
// Murasaki CLI entry point.
// Usage:
//   murasaki dev      Start the development server (HMR + native menu)
//   murasaki build    Bundle for production → dist/server.js

import 'tsx/esm' // Register the TS+JSX ESM loader (for the user's src/)
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cmd = process.argv[2]

async function loadModule(name) {
  const distPath = resolve(__dirname, '..', 'dist', name + '.js')
  const srcPath = resolve(__dirname, '..', 'src', name + '.tsx')
  const srcAlt = resolve(__dirname, '..', 'src', name + '.ts')
  const target = existsSync(distPath) ? distPath : existsSync(srcPath) ? srcPath : srcAlt
  return import(pathToFileURL(target).href)
}

if (cmd === 'dev') {
  process.env.MURASAKI_DEV = '1'
  await loadModule('dev')
} else if (cmd === 'build') {
  const mod = await loadModule('build')
  await mod.build()
} else {
  process.stdout.write(`
Usage:
  murasaki dev      Start the development server (HMR)
  murasaki build    Bundle for production → dist/server.js

`)
  process.exit(cmd ? 1 : 0)
}
