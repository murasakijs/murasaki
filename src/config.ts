// murasaki.config.{ts,js,json} — user-facing build/runtime configuration.
//
// Lookup order (first match wins):
//   1. murasaki.config.ts            (typed, runs through tsx)
//   2. murasaki.config.js            (ESM/CJS, plain JS)
//   3. murasaki.config.json          (static)
//   4. package.json's "murasaki" field
//   5. defaults

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectRoot } from './env.ts'

export type MurasakiConfig = {
  /** Display name. Defaults to package.json name (scope stripped). */
  name?: string

  /** Bundle identifier (reverse DNS). Used by .app, .msi, etc. */
  bundleId?: string

  /** App version. Defaults to package.json version. */
  version?: string

  /** Short app description. */
  description?: string

  /** Copyright string. */
  copyright?: string

  /**
   * Path to an icon file relative to the project root.
   *   .icns for macOS
   *   .ico  for Windows
   *   .png  for Linux
   * murasaki copies the appropriate file into the produced bundle.
   */
  icon?: string

  /**
   * macOS LSApplicationCategoryType. Common values:
   *   "public.app-category.productivity"
   *   "public.app-category.developer-tools"
   *   "public.app-category.utilities" (default)
   */
  category?: string

  /**
   * Default build targets when none is specified on the CLI.
   * If absent, `bundle/installer` defaults to the current host.
   */
  targets?: Array<
    | 'darwin-arm64'
    | 'darwin-x64'
    | 'win-x64'
    | 'win-arm64'
    | 'linux-x64'
    | 'linux-arm64'
  >

  /**
   * Default window options. The user's root layout `metadata.window`
   * still takes precedence — this is a fallback.
   */
  window?: {
    title?: string
    width?: number
    height?: number
    minWidth?: number
    maxWidth?: number
    resizable?: boolean
  }
}

/**
 * Type-safe wrapper for murasaki.config.ts:
 *
 *   import { defineConfig } from 'murasaki'
 *
 *   export default defineConfig({
 *     name: 'My App',
 *     bundleId: 'com.example.myapp',
 *     icon: 'assets/icon.icns',
 *   })
 */
export function defineConfig(config: MurasakiConfig): MurasakiConfig {
  return config
}

let cached: MurasakiConfig | null = null

export async function loadConfig(): Promise<MurasakiConfig> {
  if (cached) return cached

  // 1. murasaki.config.ts
  const tsPath = join(projectRoot, 'murasaki.config.ts')
  if (existsSync(tsPath)) {
    const mod = await dynImport(tsPath)
    cached = (mod.default ?? mod) as MurasakiConfig
    return cached
  }

  // 2. murasaki.config.js
  const jsPath = join(projectRoot, 'murasaki.config.js')
  if (existsSync(jsPath)) {
    const mod = await dynImport(jsPath)
    cached = (mod.default ?? mod) as MurasakiConfig
    return cached
  }

  // 3. murasaki.config.json
  const jsonPath = join(projectRoot, 'murasaki.config.json')
  if (existsSync(jsonPath)) {
    try {
      cached = JSON.parse(readFileSync(jsonPath, 'utf8')) as MurasakiConfig
      return cached
    } catch {}
  }

  // 4. package.json "murasaki" field
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    if (pkg.murasaki && typeof pkg.murasaki === 'object') {
      cached = pkg.murasaki as MurasakiConfig
      return cached
    }
  } catch {}

  cached = {}
  return cached
}

async function dynImport(path: string) {
  const req = (globalThis as { __murasakiRequire?: NodeRequire }).__murasakiRequire
  if (typeof req === 'function') {
    try {
      delete req.cache?.[req.resolve(path)]
    } catch {}
    return req(path)
  }
  const url = `${pathToFileURL(path).href}?v=${Date.now()}`
  return import(url)
}

/**
 * Resolve effective values, combining config with package.json defaults.
 * Returns a fully-populated object the build pipeline can use without
 * scattering "?? fallback" everywhere.
 */
export async function resolveAppMeta(): Promise<Required<Pick<MurasakiConfig, 'name' | 'bundleId' | 'version'>> & MurasakiConfig> {
  const cfg = await loadConfig()
  let pkg: Record<string, unknown> = {}
  try {
    pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  } catch {}

  const rawName = (pkg.name as string | undefined) || 'app'
  let defaultName = rawName
  if (defaultName.startsWith('@')) {
    const slash = defaultName.indexOf('/')
    defaultName = slash > 0 ? defaultName.slice(slash + 1) : defaultName.slice(1)
  }

  return {
    ...cfg,
    name: cfg.name ?? defaultName,
    bundleId:
      cfg.bundleId ??
      `app.${defaultName.replace(/[^a-z0-9]/gi, '').toLowerCase()}.murasaki`,
    version: cfg.version ?? ((pkg.version as string) || '0.0.0'),
  }
}
