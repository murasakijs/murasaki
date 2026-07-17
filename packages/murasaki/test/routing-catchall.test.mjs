import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { matchRoute } from '../dist/react/app-router.js'
import { fileRouterPlugin } from '../dist/vite-plugin/routing.js'

// Same private resolved id `vite-plugin/routing.ts`'s plugin uses internally
// for its `virtual:murasaki/routes` module — stable and referenced publicly
// (vite-plugin/shell.ts imports the un-prefixed `virtual:murasaki/routes`).
const RESOLVED_ROUTES_ID = '\0virtual:murasaki/routes'

async function page(root, segments) {
  const dir = join(root, 'app', ...segments)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'page.tsx'), 'export default function Page() { return null }\n')
}

test('vite-plugin/routing.ts normalizes catch-all and optional catch-all directories', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-routing-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await page(root, [])
  await page(root, ['blog', '[slug]'])
  await page(root, ['blog', '[...slug]'])
  await page(root, ['proxy', '[[...path]]'])
  await page(root, ['(marketing)', 'about'])

  const plugin = fileRouterPlugin({ srcDir: root })
  const source = await plugin.load(RESOLVED_ROUTES_ID)

  assert.match(source, /urlPath: "\/"/)
  assert.match(source, /urlPath: "\/blog\/:slug"/)
  assert.match(source, /urlPath: "\/blog\/:slug\*"/)
  assert.match(source, /urlPath: "\/proxy\/:path\?\*"/)
  // Route groups (parens) organize routes without adding a URL segment.
  assert.match(source, /urlPath: "\/about"/)
})

test('matchRoute prefers static, then dynamic, then catch-all, then optional catch-all', () => {
  const routes = [
    { urlPath: '/blog/:slug*', isDynamic: true, page: {} },
    { urlPath: '/blog/:slug', isDynamic: true, page: {} },
    { urlPath: '/blog/recent', isDynamic: false, page: {} },
  ]

  assert.equal(matchRoute(routes, '/blog/recent')?.route.urlPath, '/blog/recent')
  assert.equal(matchRoute(routes, '/blog/hello')?.route.urlPath, '/blog/:slug')
  assert.equal(matchRoute(routes, '/blog/a/b')?.route.urlPath, '/blog/:slug*')

  const withOptional = [
    { urlPath: '/docs/:slug*', isDynamic: true, page: {} },
    { urlPath: '/docs/:slug?*', isDynamic: true, page: {} },
  ]
  // Both match `/docs/a/b`; the required catch-all is more specific.
  assert.equal(matchRoute(withOptional, '/docs/a/b')?.route.urlPath, '/docs/:slug*')
  // Only the optional catch-all matches the parent path itself.
  assert.equal(matchRoute(withOptional, '/docs')?.route.urlPath, '/docs/:slug?*')
})

test('catch-all params are decoded string[] arrays; a required catch-all needs >=1 segment', () => {
  const routes = [{ urlPath: '/files/:path*', isDynamic: true, page: {} }]

  assert.deepEqual(matchRoute(routes, '/files/a/b%20c')?.params, { path: ['a', 'b c'] })
  assert.equal(matchRoute(routes, '/files'), null)
})

test('optional catch-all matches its parent path with the param left unset', () => {
  const routes = [{ urlPath: '/proxy/:path?*', isDynamic: true, page: {} }]

  assert.deepEqual(matchRoute(routes, '/proxy')?.params, {})
  assert.equal(matchRoute(routes, '/proxy')?.params.path, undefined)
  assert.deepEqual(matchRoute(routes, '/proxy/a/b')?.params, { path: ['a', 'b'] })
})

test('catch-all segments only match at their own depth (route + path lengths must line up)', () => {
  const routes = [{ urlPath: '/a/:rest*', isDynamic: true, page: {} }]
  assert.equal(matchRoute(routes, '/a'), null)
  assert.equal(matchRoute(routes, '/b/c'), null)
  assert.deepEqual(matchRoute(routes, '/a/c')?.params, { rest: ['c'] })
})
