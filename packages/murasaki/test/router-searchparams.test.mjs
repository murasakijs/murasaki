import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

// `useSearchParams`/`<Link>`/`<AppRouter>` are DOM-reactive (history +
// popstate), so this file spins up a jsdom `window` for the process. Node's
// test runner isolates each `test/*.test.mjs` file, so these globals don't
// leak into other test files.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.history = dom.window.history
globalThis.location = dom.window.location
globalThis.CustomEvent = dom.window.CustomEvent
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { act, createElement: h } = React
const { createRoot } = await import('react-dom/client')
const { AppRouter } = await import('../dist/react/app-router.js')
const { Link, useRouter, useSearchParams } = await import('../dist/react/router.js')

/** Mounts `element` into a fresh `<div>` appended to `document.body`. */
async function mount(element) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return {
    container,
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

test('useSearchParams reflects the current query string and stays stable when it does not change', async (t) => {
  window.history.pushState(null, '', '/blog/a?x=1')

  const seen = []
  let push
  function Probe() {
    const params = useSearchParams()
    push = useRouter().push
    seen.push(params)
    return null
  }

  const view = await mount(h(Probe))
  t.after(() => view.unmount())

  assert.equal(seen.at(-1).get('x'), '1')

  // Same href — the query string is unchanged, so the memoized
  // URLSearchParams instance should be reused.
  await act(async () => push('/blog/a?x=1'))
  assert.equal(seen.length, 2)
  assert.equal(seen[0], seen[1])

  // A real query change produces a new instance with the new value.
  await act(async () => push('/blog/a?x=2'))
  assert.equal(seen.at(-1).get('x'), '2')
  assert.notEqual(seen.at(-2), seen.at(-1))
})

test('useSearchParams is reactive to popstate (browser back/forward)', async (t) => {
  window.history.pushState(null, '', '/search?q=a')
  window.history.pushState(null, '', '/search?q=b')

  const seen = []
  function Probe() {
    seen.push(useSearchParams().get('q'))
    return null
  }
  const view = await mount(h(Probe))
  t.after(() => view.unmount())

  assert.equal(seen.at(-1), 'b')
  await act(async () => {
    window.history.back()
    // jsdom fires `popstate` asynchronously after a history traversal.
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
  })
  assert.equal(seen.at(-1), 'a')
})

test('router.push splits an href with a query string and hash into pathname + search for matching', async (t) => {
  window.history.pushState(null, '', '/')

  const seenPathname = []
  const seenSearch = []
  let push
  function Home() {
    const router = useRouter()
    push = router.push
    seenPathname.push(router.pathname)
    seenSearch.push(router.search)
    return null
  }
  const routes = [{ urlPath: '/', isDynamic: false, page: { default: Home } }]

  const view = await mount(h(AppRouter, { routes }))
  t.after(() => view.unmount())

  await act(async () => push('/?x=1#section'))

  // Still matches "/" (search/hash don't affect route matching).
  assert.equal(seenPathname.at(-1), '/')
  assert.equal(seenSearch.at(-1), '?x=1')
  assert.equal(window.location.hash, '#section')
})

test('<Link href="...?query"> navigates through <AppRouter> and useSearchParams reflects it', async (t) => {
  window.history.pushState(null, '', '/')

  function Home() {
    return h(Link, { href: '/blog/hello?x=1' }, 'Go')
  }
  const seenSearch = []
  function BlogPost() {
    seenSearch.push(useSearchParams().toString())
    return null
  }
  const routes = [
    { urlPath: '/', isDynamic: false, page: { default: Home } },
    { urlPath: '/blog/:slug', isDynamic: true, page: { default: BlogPost } },
  ]

  const view = await mount(h(AppRouter, { routes }))
  t.after(() => view.unmount())

  const anchor = view.container.querySelector('a')
  assert.equal(anchor?.getAttribute('href'), '/blog/hello?x=1')

  await act(async () => {
    anchor.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })

  assert.equal(window.location.pathname, '/blog/hello')
  assert.equal(window.location.search, '?x=1')
  assert.deepEqual(seenSearch, ['x=1'])
})

test('middleware receives an additive `search` alongside the existing `pathname`', async (t) => {
  window.history.pushState(null, '', '/dashboard?tab=settings')

  const seenCtx = []
  const middleware = (ctx) => {
    seenCtx.push(ctx)
  }
  const routes = [{ urlPath: '/dashboard', isDynamic: false, page: { default: () => null } }]

  const view = await mount(h(AppRouter, { routes, middleware }))
  t.after(() => view.unmount())

  assert.equal(seenCtx.length, 1)
  assert.deepEqual(seenCtx[0], { pathname: '/dashboard', search: '?tab=settings' })
})

test('middleware only re-runs on pathname changes, not query-only navigations', async (t) => {
  window.history.pushState(null, '', '/dashboard?tab=settings')

  let calls = 0
  const middleware = () => {
    calls++
  }
  let push
  function DashboardPage() {
    push = useRouter().push
    return null
  }
  const routes = [{ urlPath: '/dashboard', isDynamic: false, page: { default: DashboardPage } }]

  const view = await mount(h(AppRouter, { routes, middleware }))
  t.after(() => view.unmount())

  assert.equal(calls, 1)

  await act(async () => push('/dashboard?tab=profile'))
  assert.equal(window.location.search, '?tab=profile')
  assert.equal(calls, 1, 'a query-only navigation should not re-run middleware')

  // A real pathname change still re-runs it, as before.
  await act(async () => push('/dashboard/settings?tab=profile'))
  assert.equal(calls, 2)
})

test('middleware redirecting to the same pathname with a different query applies it without hanging or looping', async (t) => {
  window.history.pushState(null, '', '/a')

  let calls = 0
  const middleware = ({ pathname, search }) => {
    calls++
    if (pathname === '/a' && search === '') return { redirect: '/a?x=1' }
  }
  const seenSearch = []
  function PageA() {
    seenSearch.push(useSearchParams().toString())
    return null
  }
  const routes = [{ urlPath: '/a', isDynamic: false, page: { default: PageA } }]

  const view = await mount(h(AppRouter, { routes, middleware }))
  t.after(() => view.unmount())

  // The query-normalizing redirect applied, the page rendered with it, and
  // middleware was not re-invoked (a pathname-unchanged redirect must not
  // hang forever or loop).
  assert.equal(window.location.pathname, '/a')
  assert.equal(window.location.search, '?x=1')
  assert.deepEqual(seenSearch, ['x=1'])
  assert.equal(calls, 1)
})
