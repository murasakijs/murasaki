import {
  validateConfig,
  type BundleConfig,
  type BundleResource,
  type MurasakiBuildTarget,
  type MurasakiConfig,
  type MurasakiPlugin,
  type MurasakiPluginCommand,
  type MurasakiPluginHookConfig,
  type MurasakiPluginHookContext,
} from './config.js'
import type { PluginOption } from 'vite'

export interface PreparedPlugins {
  /** Config with all bundle contributions merged; the input is never mutated. */
  config: MurasakiConfig
  /** Vite contributions in configuration/declaration order. */
  vite: PluginOption[]
  /** Validated plugin declarations in configuration order. */
  plugins: readonly MurasakiPlugin[]
}

/** Resolve plugin contributions once at a CLI/Vite boundary. */
export function preparePlugins(config: MurasakiConfig): PreparedPlugins {
  validateConfig(config)
  const plugins = config.plugins ?? []
  const external = orderedUnique([
    ...(config.bundle?.external ?? []),
    ...plugins.flatMap((plugin) => plugin.bundle?.external ?? []),
  ])
  const noExternal = orderedUnique([
    ...(config.bundle?.noExternal ?? []),
    ...plugins.flatMap((plugin) => plugin.bundle?.noExternal ?? []),
  ])
  const noExternalSet = new Set(noExternal)
  const resources = orderedUniqueResources([
    ...(config.bundle?.resources ?? []),
    ...plugins.flatMap((plugin) => plugin.bundle?.resources ?? []),
  ])
  const hasBundle = config.bundle !== undefined
    || plugins.some((plugin) => plugin.bundle !== undefined)
  const bundle: BundleConfig | undefined = hasBundle
    ? {
        // A package cannot be both staged and bundled. noExternal wins
        // regardless of which declaration appeared first.
        external: external.filter((name) => !noExternalSet.has(name)),
        noExternal,
        resources,
      }
    : undefined

  return {
    config: { ...config, ...(bundle ? { bundle } : {}) },
    vite: plugins.flatMap((plugin) => flattenViteOption(plugin.vite)),
    plugins,
  }
}

/** Run a lifecycle phase serially and stop on the first failing plugin. */
export async function runPluginHooks(
  prepared: PreparedPlugins,
  phase: 'before' | 'after',
  options: {
    projectRoot: string
    command: MurasakiPluginCommand
    target?: MurasakiBuildTarget
  },
): Promise<void> {
  const context: MurasakiPluginHookContext = Object.freeze({
    projectRoot: options.projectRoot,
    config: readonlyConfig(prepared.config),
    command: options.command,
    ...(options.target ? { target: options.target } : {}),
  })

  for (const plugin of prepared.plugins) {
    const hook = plugin.hooks?.[phase]
    if (!hook) continue
    try {
      await hook(context)
    } catch (cause) {
      throw new Error(
        `murasaki: plugin ${JSON.stringify(plugin.name)} ${phase} hook failed: ${errorMessage(cause)}`,
        { cause },
      )
    }
  }
}

function orderedUnique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function orderedUniqueResources(values: readonly BundleResource[]): BundleResource[] {
  const seen = new Set<string>()
  return values.filter((item) => {
    const key = typeof item === 'string'
      ? `string\0${item}`
      : `object\0${item.from}\0${item.to ?? ''}\0${item.executable === true ? 'executable' : 'data'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function flattenViteOption(value: PluginOption | undefined): PluginOption[] {
  if (value === undefined || value === null || value === false) return []
  if (Array.isArray(value)) return value.flatMap((entry) => flattenViteOption(entry))
  return [value]
}

function readonlyConfig(config: MurasakiConfig): MurasakiPluginHookConfig {
  const { plugins: _plugins, ...publicConfig } = config
  return cloneAndFreeze(publicConfig) as MurasakiPluginHookConfig
}

function cloneAndFreeze(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreeze(entry)))
  }
  if (value && typeof value === 'object') {
    const clone: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneAndFreeze(entry)
    return Object.freeze(clone)
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
