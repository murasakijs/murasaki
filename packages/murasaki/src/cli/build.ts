import { build as viteBuild } from 'vite'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { murasaki } from '../vite-plugin/index.js'
import type { MurasakiConfig } from '../config.js'
import { banner, dim, error, success, viteLogger } from './brand.js'

type EmittedFile = { fileName: string; code?: string; source?: string | Uint8Array }

export default async function build(_argv: string[]) {
  const cwd = process.cwd()
  const config = await loadUserConfig(cwd)
  const srcDir = resolve(cwd, 'src')

  process.stdout.write(`\n${banner({ mode: 'build' })}\n\n`)

  const start = performance.now()
  let result: unknown
  try {
    result = await viteBuild({
      root: cwd,
      plugins: murasaki({ config, srcDir }),
      build: {
        outDir: resolve(cwd, 'dist/client'),
        emptyOutDir: true,
        target: 'chrome110',
      },
      // Vite's own build logs are silenced — murasaki prints its own summary
      // below. Real warnings/errors still surface via viteLogger().
      logLevel: 'silent',
      customLogger: viteLogger(),
    })
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
