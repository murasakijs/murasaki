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
}

export type StaticRoutes = {
  rootLayout: LoadedModule | null
  routes: StaticRouteEntry[]
  globalsCss?: string
}

let registry: StaticRoutes | null = null

export function setStaticRoutes(r: StaticRoutes): void {
  registry = r
}

export function getStaticRoutes(): StaticRoutes | null {
  return registry
}
