// Rendering-level coverage for src/react/app-router.tsx's <AppRouter>: nested
// layout composition, the loading/error boundaries, not-found fallback, and
// the middleware redirect/hop-guard behavior. `matchRoute` itself (pure
// logic) is covered in react-router-logic.test.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'

import { installDom, tick } from './helpers/dom.mjs'

/** Wraps a component (+ optional metadata/generateMetadata) as a RouteModule namespace object. */
function mod(Component, extra = {}) {
  return { default: Component, ...extra }
}

/** Sets up a fresh jsdom window at `url`, loads React/AppRouter fresh against it, and returns test scaffolding. */
async function setup(url) {
  const dom = installDom({ url })
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AppRouter } = await import('../dist/react/app-router.js')
  const { useRouter } = await import('../dist/react/router.js')

  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  // Suppress React's dev-mode console.error for errors caught by our own
  // <ErrorBoundary> / thrown-and-caught test fixtures — we assert on the
  // rendered fallback instead of wanting this noisy in test output.
  const root = createRoot(container, { onCaughtError() {}, onUncaughtError() {} })

  return { ...dom, React, root, container, AppRouter, useRouter }
}

/** Waits several macrotask ticks — enough for a chain of middleware promise/effect cycles to settle. */
async function settle(React, times = 6) {
  for (let i = 0; i < times; i++) {
    await React.act(async () => {
      await tick(5)
    })
  }
}

/**
 * `<DevErrorOverlay>`'s captured-errors list is module-level state, shared by
 * every `<AppRouter>` mounted in this process (dist/react/error-overlay.js is
 * only ever loaded once) — so a test that deliberately throws has to clear it
 * before finishing, or the overlay leaks a stale error banner into whichever
 * unrelated test runs next. Esc is the overlay's own documented dismissal.
 */
async function dismissDevOverlay(window, React) {
  await React.act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

test('nested layouts compose root-to-leaf around the matched page', async () => {
  const { window, React, root, container, AppRouter, cleanup } = await setup(
    'http://localhost/dashboard/settings',
  )
  try {
    function RootLayout({ children }) {
      return React.createElement('div', { 'data-layer': 'root' }, children)
    }
    function DashboardLayout({ children }) {
      return React.createElement('div', { 'data-layer': 'dashboard' }, children)
    }
    function SettingsPage() {
      return React.createElement('div', { 'data-layer': 'page' }, 'Settings')
    }

    const routes = [
      { urlPath: '/', isDynamic: false, layout: mod(RootLayout) },
      { urlPath: '/dashboard', isDynamic: false, layout: mod(DashboardLayout) },
      { urlPath: '/dashboard/settings', isDynamic: false, page: mod(SettingsPage) },
    ]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })

    const root_ = container.querySelector('[data-layer="root"]')
    assert.ok(root_, 'root layout renders')
    const dashboard = root_.querySelector(':scope > [data-layer="dashboard"]')
    assert.ok(dashboard, 'dashboard layout nests directly inside root layout')
    const page = dashboard.querySelector(':scope > [data-layer="page"]')
    assert.ok(page, 'page nests directly inside dashboard layout')
    assert.equal(page.textContent, 'Settings')
  } finally {
    cleanup()
  }
})

test('a route with no ancestor layouts renders the page directly', async () => {
  const { React, root, container, AppRouter, cleanup } = await setup('http://localhost/solo')
  try {
    function SoloPage() {
      return React.createElement('div', { 'data-layer': 'page' }, 'solo')
    }
    const routes = [{ urlPath: '/solo', isDynamic: false, page: mod(SoloPage) }]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })

    assert.equal(container.innerHTML, '<div data-layer="page">solo</div>')
  } finally {
    cleanup()
  }
})

test('loading boundary shows while a lazy page is pending, then swaps in the page', async () => {
  const { React, root, container, AppRouter, cleanup } = await setup('http://localhost/lazy')
  try {
    function Loading() {
      return React.createElement('div', null, 'loading...')
    }
    let resolveImport
    const pending = new Promise((resolve) => {
      resolveImport = resolve
    })
    const LazyPage = React.lazy(() =>
      pending.then(() => ({ default: () => React.createElement('div', null, 'lazy-loaded') })),
    )

    const routes = [{ urlPath: '/lazy', isDynamic: false, page: mod(LazyPage), loading: mod(Loading) }]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })
    assert.equal(container.textContent, 'loading...')

    await React.act(async () => {
      resolveImport()
      await pending
    })
    assert.equal(container.textContent, 'lazy-loaded')
  } finally {
    cleanup()
  }
})

test('the nearest ancestor loading file wins over a shallower one', async () => {
  const { React, root, container, AppRouter, cleanup } = await setup('http://localhost/a/b')
  try {
    function RootLoading() {
      return React.createElement('div', null, 'root-loading')
    }
    function LeafLoading() {
      return React.createElement('div', null, 'leaf-loading')
    }
    let resolveImport
    const pending = new Promise((resolve) => {
      resolveImport = resolve
    })
    const LazyPage = React.lazy(() => pending.then(() => ({ default: () => React.createElement('div', null, 'done') })))

    const routes = [
      { urlPath: '/', isDynamic: false, loading: mod(RootLoading) },
      { urlPath: '/a', isDynamic: false, loading: mod(LeafLoading) },
      { urlPath: '/a/b', isDynamic: false, page: mod(LazyPage) },
    ]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })
    assert.equal(container.textContent, 'leaf-loading')
    resolveImport()
    await React.act(async () => {
      await pending
    })
  } finally {
    cleanup()
  }
})

test('error boundary catches a throwing page, renders the route error file, and reset() re-renders after recovery', async () => {
  const { React, root, container, AppRouter, cleanup } = await setup('http://localhost/broken')
  try {
    let shouldThrow = true
    function BrokenPage() {
      if (shouldThrow) throw new Error('page exploded')
      return React.createElement('div', null, 'recovered')
    }
    function ErrorFallback({ error, reset }) {
      return React.createElement(
        'div',
        { 'data-layer': 'error' },
        React.createElement('span', { key: 'm' }, error.message),
        React.createElement('button', { key: 'b', id: 'reset', onClick: reset }, 'retry'),
      )
    }

    const routes = [
      { urlPath: '/broken', isDynamic: false, page: mod(BrokenPage), error: mod(ErrorFallback) },
    ]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })

    const errorNode = container.querySelector('[data-layer="error"]')
    assert.ok(errorNode, 'route error file renders instead of the default fallback')
    assert.equal(errorNode.querySelector('span').textContent, 'page exploded')
    await dismissDevOverlay(window, React)

    shouldThrow = false
    const resetButton = container.querySelector('#reset')
    await React.act(async () => {
      resetButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    assert.ok(!container.querySelector('[data-layer="error"]'), 'error fallback is gone after reset')
    assert.equal(container.querySelector('div').textContent, 'recovered')
  } finally {
    cleanup()
  }
})

test('with no route error file, the built-in default fallback renders and its Try again button resets', async () => {
  const { window, React, root, container, AppRouter, cleanup } = await setup('http://localhost/broken')
  try {
    let shouldThrow = true
    function BrokenPage() {
      if (shouldThrow) throw new Error('boom')
      return React.createElement('div', null, 'ok')
    }
    const routes = [{ urlPath: '/broken', isDynamic: false, page: mod(BrokenPage) }]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })

    assert.match(container.textContent, /Something went wrong\./)
    await dismissDevOverlay(window, React)
    shouldThrow = false
    const tryAgain = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try again')
    assert.ok(tryAgain)
    await React.act(async () => {
      tryAgain.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    assert.equal(container.querySelector('div').textContent, 'ok')
  } finally {
    cleanup()
  }
})

test('not-found: the deepest applicable not-found file wins for an unmatched path', async () => {
  const { React, root, container, AppRouter, cleanup } = await setup('http://localhost/docs/missing')
  try {
    function RootNotFound() {
      return React.createElement('div', null, 'root-404')
    }
    function DocsNotFound() {
      return React.createElement('div', null, 'docs-404')
    }
    const routes = [
      { urlPath: '/', isDynamic: false, notFound: mod(RootNotFound) },
      { urlPath: '/docs', isDynamic: false, notFound: mod(DocsNotFound) },
    ]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })
    assert.equal(container.textContent, 'docs-404')
  } finally {
    cleanup()
  }
})

test('not-found: falls back to a shallower not-found file when nothing deeper applies', async () => {
  const { React, root, container, AppRouter, cleanup } = await setup('http://localhost/other/missing')
  try {
    function RootNotFound() {
      return React.createElement('div', null, 'root-404')
    }
    function DocsNotFound() {
      return React.createElement('div', null, 'docs-404')
    }
    const routes = [
      { urlPath: '/', isDynamic: false, notFound: mod(RootNotFound) },
      { urlPath: '/docs', isDynamic: false, notFound: mod(DocsNotFound) },
    ]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })
    assert.equal(container.textContent, 'root-404')
  } finally {
    cleanup()
  }
})

test('not-found: with no not-found files anywhere, the built-in default 404 renders', async () => {
  const { React, root, container, AppRouter, cleanup } = await setup('http://localhost/nowhere')
  try {
    const routes = [{ urlPath: '/', isDynamic: false, page: mod(() => React.createElement('div', null, 'home')) }]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })
    assert.match(container.textContent, /404 — page not found\./)
  } finally {
    cleanup()
  }
})

test('middleware: a redirect on initial mount is honored before the requested route ever renders', async () => {
  const { window, React, root, container, AppRouter, cleanup } = await setup('http://localhost/admin')
  try {
    const routes = [
      { urlPath: '/', isDynamic: false, page: mod(() => React.createElement('div', null, 'home')) },
      { urlPath: '/admin', isDynamic: false, page: mod(() => React.createElement('div', null, 'admin')) },
    ]
    const middleware = ({ pathname }) => (pathname === '/admin' ? { redirect: '/' } : undefined)

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes, middleware }))
    })
    await settle(React, 3)
    // Never rendered "/admin" at any point — settles straight on the redirect target.
    assert.equal(window.location.pathname, '/')
    assert.equal(container.textContent, 'home')
  } finally {
    cleanup()
  }
})

test('middleware: nothing renders while it is still resolving (no flash of the pre-redirect route)', async () => {
  const { React, root, container, AppRouter, cleanup } = await setup('http://localhost/gated')
  try {
    let resolveMiddleware
    const middleware = () => new Promise((resolve) => { resolveMiddleware = resolve })
    const routes = [{ urlPath: '/gated', isDynamic: false, page: mod(() => React.createElement('div', null, 'gated content')) }]

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes, middleware }))
    })
    assert.equal(container.textContent, '', 'nothing renders while middleware is still pending')

    await React.act(async () => {
      resolveMiddleware(undefined)
      await tick(5)
    })
    assert.equal(container.textContent, 'gated content')
  } finally {
    cleanup()
  }
})

test('middleware: a redirect triggered on client-side navigation is also honored', async () => {
  const { window, React, root, container, AppRouter, useRouter, cleanup } = await setup(
    'http://localhost/public',
  )
  try {
    function PublicPage() {
      const router = useRouter()
      return React.createElement(
        'button',
        { id: 'go-admin', onClick: () => router.push('/admin') },
        'go to admin',
      )
    }
    const routes = [
      { urlPath: '/', isDynamic: false, page: mod(() => React.createElement('div', null, 'home')) },
      { urlPath: '/public', isDynamic: false, page: mod(PublicPage) },
    ]
    const middleware = ({ pathname }) => (pathname === '/admin' ? { redirect: '/' } : undefined)

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes, middleware }))
    })
    await settle(React, 2)
    assert.equal(window.location.pathname, '/public')

    const button = container.querySelector('#go-admin')
    await React.act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await settle(React, 3)

    assert.equal(window.location.pathname, '/')
    assert.equal(container.textContent, 'home')
  } finally {
    cleanup()
  }
})

test('middleware: a redirect loop is capped at MAX_MIDDLEWARE_HOPS (5), warns, and settles instead of hanging', async () => {
  const { window, React, root, container, AppRouter, cleanup } = await setup('http://localhost/')
  try {
    const routes = [
      { urlPath: '/', isDynamic: false, page: mod(() => React.createElement('div', null, 'home')) },
      { urlPath: '/loop', isDynamic: false, page: mod(() => React.createElement('div', null, 'loop')) },
    ]
    let calls = 0
    // Perpetually bounces back and forth — never converges on its own.
    const middleware = ({ pathname }) => {
      calls++
      return pathname === '/' ? { redirect: '/loop' } : { redirect: '/' }
    }

    const warnings = []
    const originalWarn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))

    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes, middleware }))
    })
    for (let i = 0; i < 15 && warnings.length === 0; i++) {
      await React.act(async () => {
        await tick(10)
      })
    }
    console.warn = originalWarn

    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /redirected 5\+ times in a row \(possible loop\)/)
    // 5 successful hops + the 6th (blocked) attempt.
    assert.equal(calls, 6)
    // Renders whatever route it gave up on, rather than staying blank forever.
    assert.ok(container.textContent === 'home' || container.textContent === 'loop')
  } finally {
    cleanup()
  }
})
