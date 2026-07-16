import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { matchApiRoute, scanApiRoutes } from '../dist/vite-plugin/api-routes.js'

async function route(root, path) {
  const dir = join(root, ...path)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'route.ts'), 'export function GET() { return new Response() }\n')
}

test('scans and matches dynamic, catch-all, and optional catch-all API routes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-api-routes-'))
  t.after(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  await route(root, ['users', '[id]'])
  await route(root, ['files', '[...path]'])
  await route(root, ['proxy', '[[...path]]'])
  await route(root, ['proxy', 'health'])

  const routes = await scanApiRoutes(root)

  assert.deepEqual(matchApiRoute(routes, '/api/users/a%20b')?.params, { id: 'a b' })
  assert.deepEqual(matchApiRoute(routes, '/api/files/a/b%20c')?.params, {
    path: ['a', 'b c'],
  })
  assert.deepEqual(matchApiRoute(routes, '/api/proxy')?.params, {})
  assert.deepEqual(matchApiRoute(routes, '/api/proxy/a/b')?.params, { path: ['a', 'b'] })
  assert.equal(matchApiRoute(routes, '/api/proxy/health')?.route.pattern, '/api/proxy/health')
  assert.equal(matchApiRoute(routes, '/api/files'), null)
})

test('prefers static then dynamic routes over catch-all routes', () => {
  const routes = [
    {
      pattern: '/api/items/:path*',
      paramNames: ['path'],
      paramKinds: ['catchAll'],
      specificity: 101,
      regexSource: '^/api/items/(.+)/?$',
      filePath: '/catch-all.ts',
    },
    {
      pattern: '/api/items/:id',
      paramNames: ['id'],
      paramKinds: ['dynamic'],
      specificity: 110,
      regexSource: '^/api/items/([^/]+)/?$',
      filePath: '/dynamic.ts',
    },
    {
      pattern: '/api/items/new',
      paramNames: [],
      paramKinds: [],
      specificity: 200,
      regexSource: '^/api/items/new/?$',
      filePath: '/static.ts',
    },
  ]

  assert.equal(matchApiRoute(routes, '/api/items/new')?.route.filePath, '/static.ts')
  assert.equal(matchApiRoute(routes, '/api/items/123')?.route.filePath, '/dynamic.ts')
  assert.equal(matchApiRoute(routes, '/api/items/123/history')?.route.filePath, '/catch-all.ts')
})
