import { build as viteBuild } from 'vite'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import pc from 'picocolors'
import { murasaki } from '../vite-plugin/index.js'
import type { MurasakiConfig } from '../config.js'

export default async function build(_argv: string[]) {
  const cwd = process.cwd()
  const config = await loadUserConfig(cwd)
  const srcDir = resolve(cwd, 'src')

  process.stdout.write(`\n  ${pc.magenta('▲')} murasaki build  ${pc.gray(config.productName)}\n\n`)

  await viteBuild({
    root: cwd,
    plugins: murasaki({ config, srcDir }),
    build: {
      outDir: resolve(cwd, 'dist/client'),
      emptyOutDir: true,
      target: 'chrome110',
    },
  })

  process.stdout.write(`  ${pc.green('✓')} dist/client written\n\n`)
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
