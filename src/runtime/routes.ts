// File-based route discovery for src/app/.
//
// Conventions (subset of Next.js app router):
//   src/app/page.tsx          → "/"
//   src/app/layout.tsx        → root layout (wraps everything)
//   src/app/about/page.tsx    → "/about"
//   src/app/about/layout.tsx  → nested layout for /about and its children
//   src/app/_foo/             → ignored (leading underscore = private)
//
// A page.tsx is required to register a route. A layout.tsx without a
// page.tsx in the same dir just contributes to children's layouts.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type Route = {
  /** URL-style path: "/", "/about", "/settings/profile" */
  path: string
  /** Absolute path to the page.tsx file */
  pageFile: string
  /** Absolute paths to layout.tsx files, OUTERMOST first (root → innermost) */
  layoutFiles: string[]
}

export function discoverRoutes(appDir: string): Route[] {
  if (!existsSync(appDir)) return []
  const out: Route[] = []
  walk(appDir, '', [], out)
  // Stable sort so "/" comes first, then alphabetical
  out.sort((a, b) => {
    if (a.path === '/') return -1
    if (b.path === '/') return 1
    return a.path.localeCompare(b.path)
  })
  return out
}

function walk(dir: string, routePath: string, layouts: string[], out: Route[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  const hasLayout = entries.includes('layout.tsx')
  const hasPage = entries.includes('page.tsx')

  // The current directory contributes its layout to itself and descendants.
  const ownLayouts = hasLayout ? [...layouts, join(dir, 'layout.tsx')] : layouts

  if (hasPage) {
    out.push({
      path: routePath || '/',
      pageFile: join(dir, 'page.tsx'),
      layoutFiles: ownLayouts,
    })
  }

  // Recurse into subdirectories (skip files, hidden, private "_*", node_modules).
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_') || entry === 'node_modules') continue
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    walk(full, `${routePath}/${entry}`, ownLayouts, out)
  }
}
