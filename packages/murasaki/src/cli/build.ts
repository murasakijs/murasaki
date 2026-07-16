import { build as viteBuild } from 'vite'
import { resolve } from 'node:path'
import { copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import { murasaki } from '../vite-plugin/index.js'
import { SHELL_HTML_PATH } from '../vite-plugin/shell.js'
import type { MurasakiConfig } from '../config.js'
import { banner, dim, error, success, viteLogger } from './brand.js'

type EmittedFile = { fileName: string; code?: string; source?: string | Uint8Array }

export default async function build(_argv: string[]) {
  const cwd = process.cwd()
  const config = await loadUserConfig(cwd)
  const srcDir = resolve(cwd, 'src')

  process.stdout.write(`\n${banner({ mode: 'build' })}\n\n`)
  await runBeforeBuild(config.build?.before, cwd)

  // Escape hatch (kept in sync with vite-plugin/shell.ts): if the project has
  // its own index.html, build with it as Vite normally would. Otherwise use
  // the framework-owned shell. Rollup resolves an HTML entry's emitted file
  // name from its path relative to `root`, so the framework's app.html (which
  // ships inside the murasaki package, outside the project) can't be passed to
  // rollupOptions.input directly — it has to be staged as a project-local
  // `index.html` first, then removed.
  const stagedEntry = resolve(cwd, 'index.html')
  const userOwnsHtml = existsSync(stagedEntry)
  const commonBuild = {
    outDir: resolve(cwd, 'dist/client'),
    emptyOutDir: true,
    target: 'chrome110' as const,
  }

  const start = performance.now()
  let result: unknown
  try {
    if (userOwnsHtml) {
      // Vite's default: the project's own index.html is the entry.
      result = await viteBuild({
        root: cwd,
        plugins: murasaki({ config, srcDir }),
        build: commonBuild,
        logLevel: 'silent',
        customLogger: viteLogger(),
      })
    } else {
      await copyFile(SHELL_HTML_PATH, stagedEntry)
      try {
        result = await viteBuild({
          root: cwd,
          plugins: murasaki({ config, srcDir }),
          build: { ...commonBuild, rollupOptions: { input: stagedEntry } },
          // Vite's own build logs are silenced — murasaki prints its own
          // summary below. Real warnings/errors still surface via viteLogger().
          logLevel: 'silent',
          customLogger: viteLogger(),
        })
      } finally {
        await rm(stagedEntry, { force: true })
      }
    }
  } catch (err) {
    process.stderr.write(`\n${error('build failed')}\n\n`)
    throw err
  }
  const ms = performance.now() - start

  const files = collectOutputFiles(result)
  if (files.length > 0) {
    const nameWidth = Math.max(...files.map((f) => f.fileName.length))
    for (const file of files) {
      const buf = toBuffer(file)
      const size = formatKb(buf.byteLength).padStart(9)
      const gzip = dim(`gzip ${formatKb(gzipSync(buf).byteLength)}`)
      process.stdout.write(`  dist/client/${file.fileName.padEnd(nameWidth)}  ${size}  ${gzip}\n`)
    }
    process.stdout.write('\n')
  }

  process.stdout.write(`${success(`built in ${(ms / 1000).toFixed(2)}s`)}\n\n`)
}

export async function runBeforeBuild(command: string | undefined, cwd: string): Promise<void> {
  if (!command?.trim()) return
  process.stdout.write(`  ${dim('before build')}  ${command}\n\n`)
  await new Promise<void>((resolveOk, rejectFail) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: process.env,
    })
    child.once('error', rejectFail)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveOk()
      else rejectFail(new Error(
        `murasaki: build.before failed${signal ? ` (${signal})` : ` with exit code ${code ?? 'unknown'}`}`,
      ))
    })
  })
}

function collectOutputFiles(result: unknown): EmittedFile[] {
  const outputs = Array.isArray(result) ? result : [result]
  return outputs.flatMap((r) =>
    r && typeof r === 'object' && 'output' in r ? ((r as { output: EmittedFile[] }).output) : [],
  )
}

function toBuffer(file: EmittedFile): Buffer {
  if (typeof file.code === 'string') return Buffer.from(file.code)
  if (file.source !== undefined) return Buffer.from(file.source as any)
  return Buffer.alloc(0)
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`
}

async function loadUserConfig(cwd: string): Promise<MurasakiConfig> {
  for (const name of ['murasaki.config.ts', 'murasaki.config.js', 'murasaki.config.mjs']) {
    const p = resolve(cwd, name)
    try {
      const mod = await import(pathToFileURL(p).href)
      const cfg = mod.default ?? mod.config ?? mod
      if (cfg && typeof cfg === 'object') return cfg
    } catch (err: any) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err
    }
  }
  throw new Error('murasaki: no config found — create murasaki.config.ts')
}
