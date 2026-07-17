// Pure-logic coverage for src/react/app-router.tsx's route matching.
//
// Only `matchRoute` is exported ("Pure route matcher — exported for unit
// testing", per its doc comment) — `ancestorChain`, `mergeMetadata`,
// `resolveStaticMetadata`, and `nearestNotFound` are module-private helpers,
// not part of the file's public surface (only `matchRoute` and `AppRouter`
// have `export` in dist/react/app-router.js). Their behavior is instead
// exercised indirectly, through full `<AppRouter>` rendering, in
// react-app-router.test.mjs (layout/loading/error ancestor chains, not-found
// fallback) and react-metadata.test.mjs (root→leaf metadata merge).
import assert from 'node:assert/strict'
import test from 'node:test'

import { matchRoute } from '../dist/react/app-router.js'

function route(urlPath, extra = {}) {
  return { urlPath, isDynamic: urlPath.includes(':'), page: {}, ...extra }
}

test('matchRoute: static segments beat dynamic ones at the same depth', () => {
  const routes = [route('/blog/:slug'), route('/blog/featured')]

  const match = matchRoute(routes, '/blog/featured')
  assert.equal(match.route.urlPath, '/blog/featured')
  assert.deepEqual(match.params, {})
})

test('matchRoute: falls back to the dynamic route when no static route matches', () => {
  const routes = [route('/blog/:slug'), route('/blog/featured')]

  const match = matchRoute(routes, '/blog/other-post')
  assert.equal(match.route.urlPath, '/blog/:slug')
  assert.deepEqual(match.params, { slug: 'other-post' })
})

test('matchRoute: more static segments wins over fewer, among same-length candidates', () => {
  const routes = [route('/shop/:category/:id'), route('/shop/sale/:id')]

  const match = matchRoute(routes, '/shop/sale/42')
  assert.equal(match.route.urlPath, '/shop/sale/:id')
  assert.deepEqual(match.params, { id: '42' })
})

test('matchRoute: dynamic segment values are URI-decoded', () => {
  const routes = [route('/blog/:slug')]

  const match = matchRoute(routes, '/blog/hello%20world')
  assert.deepEqual(match.params, { slug: 'hello world' })
})

test('matchRoute: root route matches "/"', () => {
  const routes = [route('/'), route('/about')]

  const match = matchRoute(routes, '/')
  assert.equal(match.route.urlPath, '/')
})

test('matchRoute: segment-count mismatch never matches, regardless of dynamic segments', () => {
  const routes = [route('/blog/:slug')]

  assert.equal(matchRoute(routes, '/blog'), null)
  assert.equal(matchRoute(routes, '/blog/a/b'), null)
})

test('matchRoute: entries without a `page` are never matchable (layout-only entries)', () => {
  const routes = [
    { urlPath: '/dashboard', isDynamic: false, layout: {} }, // no `page`
    route('/dashboard/settings'),
  ]

  assert.equal(matchRoute(routes, '/dashboard'), null)
  assert.notEqual(matchRoute(routes, '/dashboard/settings'), null)
})

test('matchRoute: no candidate route → null (renders as not-found upstream)', () => {
  const routes = [route('/'), route('/about')]

  assert.equal(matchRoute(routes, '/nowhere'), null)
})

test('matchRoute: route-group segments are expected to already be stripped from urlPath', () => {
  // The `murasaki:routing` vite plugin strips `(group)` segments before
  // computing `urlPath` (see src/vite-plugin/routing.ts's `isGroupSegment`) —
  // by the time a RouteEntry reaches matchRoute, a page originally at
  // `src/app/(marketing)/about/page.tsx` has already become urlPath `/about`.
  const routes = [route('/about')]
  assert.notEqual(matchRoute(routes, '/about'), null)

  // matchRoute itself has no group-awareness: segment counts are compared
  // literally, so an *unstripped* group segment would never match the real
  // (flat) pathname — demonstrating why the stripping has to happen upstream
  // rather than in matchRoute.
  const unstripped = [route('/(marketing)/about')]
  assert.equal(matchRoute(unstripped, '/about'), null)
})

test('matchRoute: trailing/leading slashes are ignored via segment splitting', () => {
  const routes = [route('/about')]
  assert.notEqual(matchRoute(routes, '/about/'), null)
})
