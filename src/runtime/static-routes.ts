// Static route registry — populated at build time by the synthetic
// entry file generated in src/build.ts. When set, render.tsx prefers
// these eagerly-imported modules over dynamic .tsx imports, so the
// runtime doesn't need the tsx loader (→ SEA-safe).

import type { Metadata } from '../index.ts'
import type { AppComponent } from '../types.ts'

export type LoadedModule = {
  default: AppComponent
  metadata?: Metadata
}

export type StaticRouteEntry = {
  /** URL path: "/", "/about", "/settings/profile", ... */
  path: string
  /** The user's page.tsx module, eagerly imported. */
  page: LoadedModule
  /** Layout chain, outermost first. The root layout is also the first entry. */
  layouts: LoadedModule[]
  /**
   * Absolute source path of page.tsx. render.tsx uses this at build time
   * to synthesize the client-side hydration bundle from the same set of
   * files.
   */
  pageFile: string
  /** Absolute source paths of layouts, same ordering as `layouts`. */
  layoutFiles: string[]
}

export type StaticRoutes = {
  rootLayout: LoadedModule | null
  /** Absolute source path of the root layout.tsx (if any). */
  rootLayoutFile: string | null
  routes: StaticRouteEntry[]
  globalsCss?: string
  /**
   * Pre-built client-side hydration bundle produced at `murasaki build` time.
   * Present in production because installed .apps do not carry user
   * source files, so runtime esbuild bundling would fail. In dev this is
   * undefined and render.tsx builds the client bundle on demand.
   */
  clientBundle?: string
}

let registry: StaticRoutes | null = null

export function setStaticRoutes(r: StaticRoutes): void {
  registry = r
}

export function getStaticRoutes(): StaticRoutes | null {
  return registry
}
