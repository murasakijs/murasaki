import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfigFromFile } from 'vite'
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
    const config: unknown = name.endsWith('.ts')
      ? await loadTypeScriptConfig(path, cwd)
      : await loadJavaScriptConfig(path)
    validateConfig(config)
    return config
  }
  throw new Error(
    'murasaki: no config found — create murasaki.config.ts at the project root.',
  )
}

async function loadTypeScriptConfig(path: string, cwd: string): Promise<unknown> {
  // Node 22.12 is Murasaki's supported floor and predates native TypeScript
  // type stripping. Vite is already a runtime dependency and provides the same
  // config bundling path across every supported Node release.
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    path,
    cwd,
    'silent',
  )
  if (!loaded) {
    throw new Error(`murasaki: failed to load config from ${path}`)
  }
  return loaded.config
}

async function loadJavaScriptConfig(path: string): Promise<unknown> {
  const mod = await import(pathToFileURL(path).href)
  return mod.default ?? mod.config ?? mod
}
