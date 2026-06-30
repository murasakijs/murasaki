// `murasaki build` — produces a single Node-runnable bundle in dist/.
//
// What it bundles:
//   - The user's src/app/* (pages, layouts, globals.css discovery)
//   - The murasaki runtime (window lifecycle, render, native bridge)
//   - The murasaki/jsx server runtime
//   - All client bundles get rebuilt at runtime via esbuild (so esbuild
//     stays as a runtime dep, just like in dev)
//
// What it does NOT bundle:
//   - @webviewjs/webview (native node module — must stay external)
//
// Output:
//   dist/server.js   ← `node dist/server.js` to run
//
// Distribution: ship dist/server.js + node_modules/@webviewjs/webview
// to your target machine and `node dist/server.js`. Real single-binary
// (SEA) packaging is a follow-up release.

import * as esbuild from 'esbuild'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot } from './env.ts'

const out = (s: string) => process.stdout.write(s)

export async function build(): Promise<void> {
  const startAt = Date.now()
  const distDir = join(projectRoot, 'dist')
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

  out('\n   🦋 Murasaki — production build\n\n')
  out(`   ${dim('Project ')}${projectRoot}\n`)
  out(`   ${dim('Out     ')}${distDir}/server.js\n\n`)

  // The bundled entry is the murasaki/prod runner. We point esbuild at
  // the murasaki package's prod.tsx (the consumer doesn't write this
  // themselves — it's the production analog of dev.tsx).
  //
  // Locate murasaki's installed prod entry. In a published install this
  // lives under <consumer>/node_modules/murasaki/dist/prod.js (compiled);
  // in workspace dev it's <repo>/murasaki/dist/prod.js.
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'prod.js'),
    join(here, '../dist/prod.js'),
    join(projectRoot, 'node_modules/murasaki/dist/prod.js'),
  ]
  const entry = candidates.find((p) => existsSync(p))
  if (!entry) {
    out(`   ${red('✗')} could not locate murasaki/dist/prod.js\n`)
    out(`     tried:\n${candidates.map((c) => `       ${c}\n`).join('')}`)
    process.exit(1)
  }

  out(`   ${dim('Entry   ')}${entry}\n`)
  out(`   ${dim('○')} bundling...\n`)

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    // Keep native add-ons external. They have to be installed alongside
    // the bundle in the destination's node_modules.
    external: ['@webviewjs/webview', 'esbuild', 'tsx', 'fsevents'],
    // Tell esbuild how to read .tsx (user pages might appear via dynamic
    // import at runtime, but the static import graph from prod.tsx pulls
    // in render.tsx etc.).
    loader: {
      '.css': 'text',
    },
    minify: false,
    sourcemap: 'inline',
    banner: {
      // ESM bundles need this when emitting to .js with Node ESM.
      js: '#!/usr/bin/env node\n',
    },
    logLevel: 'silent',
  })

  if (result.errors.length) {
    out(`   ${red('✗')} bundle failed:\n`)
    for (const e of result.errors) out(`     ${e.text}\n`)
    process.exit(1)
  }

  const outFile = result.outputFiles[0]
  const outPath = join(distDir, 'server.js')
  writeFileSync(outPath, outFile.text)

  // Make it executable for convenience.
  try {
    const { chmodSync } = await import('node:fs')
    chmodSync(outPath, 0o755)
  } catch {}

  const size = (outFile.text.length / 1024).toFixed(1)
  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1)
  out(`   ${green('✓')} ${dim('built')} ${outPath} ${dim(`(${size} KB, ${elapsed}s)`)}\n\n`)
  out(`   ${dim('Run:')} ${'node ' + outPath}\n\n`)

  // Best-effort: copy package.json so the user can see what to ship.
  try {
    const consumerPkgPath = join(projectRoot, 'package.json')
    if (existsSync(consumerPkgPath)) {
      const pkg = JSON.parse(readFileSync(consumerPkgPath, 'utf8'))
      const minimal = {
        name: pkg.name,
        version: pkg.version,
        private: true,
        type: 'module',
        main: 'server.js',
        dependencies: {
          '@webviewjs/webview': pkg.dependencies?.['@webviewjs/webview'] ?? '*',
          esbuild: pkg.dependencies?.esbuild ?? '*',
        },
      }
      writeFileSync(join(distDir, 'package.json'), JSON.stringify(minimal, null, 2))
    }
  } catch {}
}

const RESET = '\x1b[0m'
const DIM = '\x1b[38;2;136;136;153m'
const GREEN = '\x1b[38;2;76;175;80m'
const RED = '\x1b[38;2;239;68;68m'
const noColor = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY
const dim = (s: string) => (noColor ? s : DIM + s + RESET)
const green = (s: string) => (noColor ? s : GREEN + s + RESET)
const red = (s: string) => (noColor ? s : RED + s + RESET)
