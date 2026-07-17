// Coverage for src/react/metadata.ts's `applyMetadata` (direct DOM-manipulation
// unit tests) plus, since `mergeMetadata`/`resolveStaticMetadata` in
// app-router.tsx aren't exported (only `matchRoute`/`AppRouter` are — see
// react-router-logic.test.mjs), the root→leaf/one-level-deep metadata merge
// and the async generateMetadata resolution order, exercised through a full
// <AppRouter> render.
import assert from 'node:assert/strict'
import test from 'node:test'

import { installDom, tick } from './helpers/dom.mjs'

test('applyMetadata is a no-op outside a DOM environment (SSR-safe)', async () => {
  assert.equal(typeof document, 'undefined')
  const { applyMetadata } = await import('../dist/react/metadata.js')
  assert.doesNotThrow(() => applyMetadata({ title: 'Should not throw' }))
})

test('applyMetadata: sets document.title, and never blanks it when a later call has none', async () => {
  const dom = installDom({ url: 'http://localhost/' })
  try {
    const { applyMetadata } = await import('../dist/react/metadata.js')
    applyMetadata({ title: 'First' })
    assert.equal(document.title, 'First')

    applyMetadata({}) // no title this time
    assert.equal(document.title, 'First', 'title is left alone, never cleared')

    applyMetadata({ title: '' }) // empty string is likewise not applied
    assert.equal(document.title, 'First')

    applyMetadata({ title: 'Second' })
    assert.equal(document.title, 'Second')
  } finally {
    dom.cleanup()
  }
})

test('applyMetadata: description meta is created, then updated in place (not duplicated)', async () => {
  const dom = installDom({ url: 'http://localhost/' })
  try {
    const { applyMetadata } = await import('../dist/react/metadata.js')
    applyMetadata({ description: 'First description' })
    let tags = document.head.querySelectorAll('meta[name="description"]')
    assert.equal(tags.length, 1)
    assert.equal(tags[0].getAttribute('content'), 'First description')

    applyMetadata({ description: 'Second description' })
    tags = document.head.querySelectorAll('meta[name="description"]')
    assert.equal(tags.length, 1, 'still exactly one description tag, updated in place')
    assert.equal(tags[0].getAttribute('content'), 'Second description')
  } finally {
    dom.cleanup()
  }
})

test('applyMetadata: managed tags from a previous route are removed when the next one omits them', async () => {
  const dom = installDom({ url: 'http://localhost/' })
  try {
    const { applyMetadata } = await import('../dist/react/metadata.js')
    applyMetadata({ description: 'Has description', icons: { icon: '/icon.png' } })
    assert.ok(document.head.querySelector('meta[name="description"]'))
    assert.ok(document.head.querySelector('link[rel="icon"]'))

    applyMetadata({ title: 'Only a title now' })
    assert.equal(document.head.querySelector('meta[name="description"]'), null)
    assert.equal(document.head.querySelector('link[rel="icon"]'), null)
  } finally {
    dom.cleanup()
  }
})

test('applyMetadata: hand-authored (non-managed) head tags are left alone', async () => {
  const dom = installDom({ url: 'http://localhost/' })
  try {
    const manual = document.createElement('meta')
    manual.setAttribute('name', 'viewport')
    manual.setAttribute('content', 'width=device-width')
    document.head.appendChild(manual)

    const { applyMetadata } = await import('../dist/react/metadata.js')
    applyMetadata({ title: 'X', description: 'Y' })

    assert.ok(document.head.contains(manual), 'unmanaged tag survives repeated applyMetadata calls')
    assert.equal(manual.getAttribute('content'), 'width=device-width')
  } finally {
    dom.cleanup()
  }
})

test('applyMetadata: Open Graph title/description default to the page title/description, overridden when set explicitly', async () => {
  const dom = installDom({ url: 'http://localhost/' })
  try {
    const { applyMetadata } = await import('../dist/react/metadata.js')

    applyMetadata({ title: 'Page Title', description: 'Page description' })
    assert.equal(document.head.querySelector('meta[property="og:title"]').getAttribute('content'), 'Page Title')
    assert.equal(
      document.head.querySelector('meta[property="og:description"]').getAttribute('content'),
      'Page description',
    )

    applyMetadata({
      title: 'Page Title',
      description: 'Page description',
      openGraph: { title: 'OG Title', description: 'OG description' },
    })
    assert.equal(document.head.querySelector('meta[property="og:title"]').getAttribute('content'), 'OG Title')
    assert.equal(
      document.head.querySelector('meta[property="og:description"]').getAttribute('content'),
      'OG description',
    )
  } finally {
    dom.cleanup()
  }
})

test('applyMetadata: og:image comes from the first openGraph.images entry', async () => {
  const dom = installDom({ url: 'http://localhost/' })
  try {
    const { applyMetadata } = await import('../dist/react/metadata.js')
    applyMetadata({ openGraph: { images: ['/one.png', '/two.png'] } })
    assert.equal(document.head.querySelector('meta[property="og:image"]').getAttribute('content'), '/one.png')
  } finally {
    dom.cleanup()
  }
})

test('applyMetadata: favicon link is created, then its href is updated in place across navigations', async () => {
  const dom = installDom({ url: 'http://localhost/' })
  try {
    const { applyMetadata } = await import('../dist/react/metadata.js')
    applyMetadata({ icons: { icon: '/favicon-a.png' } })
    let links = document.head.querySelectorAll('link[rel="icon"]')
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), '/favicon-a.png')

    applyMetadata({ icons: { icon: '/favicon-b.png' } })
    links = document.head.querySelectorAll('link[rel="icon"]')
    assert.equal(links.length, 1, 'still exactly one favicon link')
    assert.equal(links[0].getAttribute('href'), '/favicon-b.png')
  } finally {
    dom.cleanup()
  }
})

// NOTE: `Metadata.icons` also documents `shortcut`/`apple` fields, but
// applyMetadata only ever reads `icons.icon` (see upsertLink('icon', …) — the
// only upsertLink call in metadata.ts). `shortcut`/`apple` are accepted into
// the type and survive mergeMetadata's icons merge (see the AppRouter
// integration test below), but are never rendered as a <link> tag. Not
// necessarily a bug — may be reserved API surface — documented here as
// observed current behavior.
test('applyMetadata: icons.shortcut / icons.apple are accepted but not rendered as link tags', async () => {
  const dom = installDom({ url: 'http://localhost/' })
  try {
    const { applyMetadata } = await import('../dist/react/metadata.js')
    applyMetadata({ icons: { shortcut: '/shortcut.png', apple: '/apple.png' } })
    assert.equal(document.head.querySelector('link[rel="icon"]'), null)
    assert.equal(document.head.querySelector('link[rel="shortcut"]'), null)
    assert.equal(document.head.querySelector('link[rel="apple"]'), null)
  } finally {
    dom.cleanup()
  }
})

test('AppRouter integration: root layout metadata merges with the leaf page metadata (root→leaf, icons/openGraph merged one level deep)', async () => {
  const dom = installDom({ url: 'http://localhost/blog/post' })
  try {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { AppRouter } = await import('../dist/react/app-router.js')
    const mod = (Component, extra = {}) => ({ default: Component, ...extra })

    const routes = [
      {
        urlPath: '/',
        isDynamic: false,
        layout: mod(({ children }) => React.createElement('div', null, children), {
          metadata: { icons: { icon: '/root-icon.png' }, openGraph: { title: 'Root OG' } },
        }),
      },
      {
        urlPath: '/blog/post',
        isDynamic: false,
        page: mod(() => React.createElement('div', null, 'post'), {
          metadata: {
            title: 'Leaf Title',
            icons: { shortcut: '/leaf-shortcut.png' },
            openGraph: { description: 'Leaf OG Description' },
          },
        }),
      },
    ]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container, { onCaughtError() {}, onUncaughtError() {} })
    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })

    // Leaf page's own title wins outright (mergeMetadata's shallow spread).
    assert.equal(document.title, 'Leaf Title')
    // icons merged one level deep: root's `icon` survives alongside the leaf's `shortcut`.
    assert.equal(document.head.querySelector('link[rel="icon"]').getAttribute('href'), '/root-icon.png')
    // openGraph merged one level deep too: root's og:title survives; leaf adds og:description.
    assert.equal(document.head.querySelector('meta[property="og:title"]').getAttribute('content'), 'Root OG')
    assert.equal(
      document.head.querySelector('meta[property="og:description"]').getAttribute('content'),
      'Leaf OG Description',
    )
  } finally {
    dom.cleanup()
  }
})

test('AppRouter integration: generateMetadata resolves before anything is applied — no flash of static-only metadata, then the merged result wins', async () => {
  const dom = installDom({ url: 'http://localhost/post' })
  try {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { AppRouter } = await import('../dist/react/app-router.js')
    const mod = (Component, extra = {}) => ({ default: Component, ...extra })

    let resolveGenerate
    const routes = [
      {
        urlPath: '/post',
        isDynamic: false,
        page: mod(() => React.createElement('div', null, 'post'), {
          metadata: { title: 'Static Title', description: 'Static description' },
          generateMetadata: () => new Promise((resolve) => (resolveGenerate = resolve)),
        }),
      },
    ]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container, { onCaughtError() {}, onUncaughtError() {} })
    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })
    // Static metadata is never applied on its own while generateMetadata is pending.
    assert.equal(document.title, '')
    assert.equal(document.head.querySelector('meta[name="description"]'), null)

    await React.act(async () => {
      resolveGenerate({ title: 'Generated Title' }) // no `description` — static's should survive the merge
      await tick(10)
    })
    assert.equal(document.title, 'Generated Title')
    assert.equal(
      document.head.querySelector('meta[name="description"]').getAttribute('content'),
      'Static description',
    )
  } finally {
    dom.cleanup()
  }
})

test('AppRouter integration: a rejected generateMetadata logs and falls back to the static metadata', async () => {
  const dom = installDom({ url: 'http://localhost/err' })
  try {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { AppRouter } = await import('../dist/react/app-router.js')
    const mod = (Component, extra = {}) => ({ default: Component, ...extra })

    const routes = [
      {
        urlPath: '/err',
        isDynamic: false,
        page: mod(() => React.createElement('div', null, 'x'), {
          metadata: { title: 'Static Fallback' },
          generateMetadata: () => Promise.reject(new Error('generateMetadata blew up')),
        }),
      },
    ]

    const errors = []
    const originalError = console.error
    console.error = (...args) => errors.push(args.join(' '))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container, { onCaughtError() {}, onUncaughtError() {} })
    await React.act(async () => {
      root.render(React.createElement(AppRouter, { routes }))
    })
    await React.act(async () => {
      await tick(20)
    })
    console.error = originalError

    assert.equal(document.title, 'Static Fallback')
    assert.ok(errors.some((line) => line.includes('generateMetadata failed')))
  } finally {
    dom.cleanup()
  }
})
