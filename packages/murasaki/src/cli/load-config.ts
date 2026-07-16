import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateConfig, type MurasakiConfig } from '../config.js'

const CONFIG_NAMES = [
  'murasaki.config.ts',
  'murasaki.config.js',
  'murasaki.config.mjs',
] as const

/** Load and runtime-validate a project config regardless of its export style. */
export async function loadUserConfig(cwd: string): Promise<MurasakiConfig> {
  for (const name of CONFIG_NAMES) {
    const path = resolve(cwd, name)
    if (!existsSync(path)) continue

    // Do not catch ERR_MODULE_NOT_FOUND here: it may describe a dependency
    // imported by an existing config and should surface with its real context.
    const mod = await import(pathToFileURL(path).href)
    const config: unknown = mod.default ?? mod.config ?? mod
    validateConfig(config)
    return config
  }
  throw new Error(
    'murasaki: no config found — create murasaki.config.ts at the project root.',
  )
}
