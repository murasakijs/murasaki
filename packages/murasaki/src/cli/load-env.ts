import { loadEnv } from 'vite'

/** Renderer variables must opt in explicitly; everything else stays Node-only. */
export const DEFAULT_RENDERER_ENV_PREFIX = ['MURASAKI_PUBLIC_'] as const

/**
 * Load the same four-file hierarchy used by Vite/Next-style projects:
 * `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local`.
 *
 * Existing process variables win over files. Loading into `process.env` makes
 * private values available to config, plugin hooks, Node Main, Server Actions,
 * and API Routes without exposing them to renderer code. Vite separately
 * filters renderer values through `build.envPrefix`.
 */
export function loadProjectEnv(projectRoot: string, mode: string): Record<string, string> {
  const resolved = loadEnv(mode, projectRoot, '')
  for (const [key, value] of Object.entries(resolved)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  return resolved
}
