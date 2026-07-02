import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, cp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import pc from 'picocolors'
import bundle from './bundle.js'
import type { MurasakiConfig } from '../config.js'

/**
 * Wrap the `.app` produced by `bundle` into a drag-to-install `.dmg`, via
 * `hdiutil` — the same tool Finder uses under the hood, so no extra
 * dependency is needed on macOS.
 */
export default async function installer(argv: string[]) {
  const cwd = process.cwd()

  if (process.platform !== 'darwin') {
    process.stdout.write(
      `\n  ${pc.yellow('!')} installer: only macOS (.dmg) is supported right now.\n\n`,
    )
    return
  }

  const config = await loadUserConfig(cwd)
  const productName = config.productName
  const version = config.version ?? '0.0.0'
  const appDir = resolve(cwd, 'dist/bundle', `${productName}.app`)
  if (!existsSync(appDir)) await bundle(argv)

  const staging = await mkdtemp(join(tmpdir(), 'murasaki-dmg-'))
  try {
    await cp(appDir, join(staging, `${productName}.app`), { recursive: true })
    // Drag-to-install affordance: a symlink to /Applications sitting next
    // to the .app inside the mounted volume.
    await symlink('/Applications', join(staging, 'Applications'))

    const dmgPath = resolve(cwd, 'dist', `${productName}-${version}.dmg`)
    await rm(dmgPath, { force: true })

    const result = spawnSync(
      'hdiutil',
      ['create', '-volname', productName, '-srcfolder', staging, '-ov', '-format', 'UDZO', dmgPath],
      { encoding: 'utf8' },
    )

    if (result.status !== 0) {
      process.stderr.write(
        `\n  ${pc.red('✗')} hdiutil failed\n\n${result.stderr}\n`,
      )
      process.exit(result.status ?? 1)
    }

    process.stdout.write(`\n  ${pc.green('✓')} installer written  ${pc.gray(dmgPath)}\n\n`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
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
