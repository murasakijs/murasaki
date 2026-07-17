// Coverage for src/react/router.tsx: <Link>'s click interception, useRouter /
// usePathname / useParams, and popstate handling. <AppRouter>'s own router
// context wiring is covered in react-app-router.test.mjs — this file exercises
// router.tsx's exports directly (standalone, and against a hand-rolled
// RouterContext.Provider standing in for <AppRouter>).
import assert from 'node:assert/strict'
import test from 'node:test'

import { installDom, tick } from './helpers/dom.mjs'

async function setup(url) {
  const dom = installDom({ url })
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const router = await import('../dist/react/router.js')

  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  const root = createRoot(container)

  return { ...dom, React, root, container, router }
}

function click(window, el, extra = {}) {
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, ...extra })
  el.dispatchEvent(event)
  return event
}

test('Link: an unmodified click is intercepted — preventDefault + history.pushState, no real navigation', async () => {
  const { window, React, root, container, router, cleanup } = await setup('http://localhost/')
  try {
    await React.act(async () => {
      root.render(React.createElement(router.Link, { href: '/about' }, 'About'))
    })
    const anchor = container.querySelector('a')
    assert.equal(anchor.getAttribute('href'), '/about')

    let event
    await React.act(async () => {
      event = click(window, anchor)
    })
    assert.equal(event.defaultPrevented, true)
    assert.equal(window.location.pathname, '/about')
  } finally {
    cleanup()
  }
})

test('Link: `replace` uses history.replaceState (via the fallback path, with no router context)', async () => {
  const { window, React, root, container, router, cleanup } = await setup('http://localhost/start')
  try {
    await React.act(async () => {
      root.render(React.createElement(router.Link, { href: '/swapped', replace: true }, 'Swap'))
    })
    const initialLength = window.history.length
    await React.act(async () => {
      click(window, container.querySelector('a'))
    })
    assert.equal(window.location.pathname, '/swapped')
    // replaceState doesn't grow the history stack the way pushState does.
    assert.equal(window.history.length, initialLength)
  } finally {
    cleanup()
  }
})

test('Link: with a RouterContext in scope, navigation goes through router.push/replace instead of the window.history fallback', async () => {
  const { window, React, root, container, router, cleanup } = await setup('http://localhost/')
  try {
    const pushCalls = []
    const replaceCalls = []
    const mockRouter = {
      pathname: '/',
      push: (to) => pushCalls.push(to),
      replace: (to) => replaceCalls.push(to),
      back: () => {},
    }

    await React.act(async () => {
      root.render(
        React.createElement(
          router.RouterContext.Provider,
          { value: mockRouter },
          React.createElement(router.Link, { href: '/dash' }, 'Dash'),
          React.createElement(router.Link, { href: '/dash2', replace: true }, 'Dash2'),
        ),
      )
    })
    const [a1, a2] = container.querySelectorAll('a')

    await React.act(async () => {
      click(window, a1)
    })
    assert.deepEqual(pushCalls, ['/dash'])
    // The mock router doesn't itself touch window.history, so this proves
    // Link deferred to it instead of falling back to pushState directly.
    assert.equal(window.location.pathname, '/')

    await React.act(async () => {
      click(window, a2)
    })
    assert.deepEqual(replaceCalls, ['/dash2'])
  } finally {
    cleanup()
  }
})

test('Link: a modified click (metaKey/ctrlKey/shiftKey/altKey) is never intercepted', async () => {
  const { window, React, root, container, router, cleanup } = await setup('http://localhost/')
  try {
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      await React.act(async () => {
        root.render(React.createElement(router.Link, { href: `#${modifier}` }, modifier))
      })
      const anchor = container.querySelector('a')
      let event
      await React.act(async () => {
        event = click(window, anchor, { [modifier]: true })
        // jsdom processes the anchor's default (hash) navigation asynchronously.
        await tick(30)
      })
      assert.equal(event.defaultPrevented, false, `${modifier}: default not prevented`)
      // Real (jsdom-supported) hash navigation actually ran, proving Link
      // stepped aside entirely rather than swallowing the click.
      assert.equal(window.location.hash, `#${modifier}`)
    }
  } finally {
    cleanup()
  }
})

test('Link: an already-defaultPrevented click (e.g. from a capturing ancestor) is left alone', async () => {
  const { window, React, root, container, router, cleanup } = await setup('http://localhost/')
  try {
    let pushed = false
    const mockRouter = { pathname: '/', push: () => (pushed = true), replace: () => {}, back: () => {} }

    await React.act(async () => {
      root.render(
        React.createElement(
          router.RouterContext.Provider,
          { value: mockRouter },
          React.createElement(
            'div',
            { onClickCapture: (e) => e.preventDefault() },
            React.createElement(router.Link, { href: '/never' }, 'Never'),
          ),
        ),
      )
    })
    await React.act(async () => {
      click(window, container.querySelector('a'))
    })
    assert.equal(pushed, false, 'Link must not navigate once the event already arrived defaultPrevented')
  } finally {
    cleanup()
  }
})

test('Link: forwards a custom onClick alongside its own interception', async () => {
  const { window, React, root, container, router, cleanup } = await setup('http://localhost/')
  try {
    let customCalls = 0
    await React.act(async () => {
      root.render(React.createElement(router.Link, { href: '/x', onClick: () => customCalls++ }, 'X'))
    })
    await React.act(async () => {
      click(window, container.querySelector('a'))
    })
    assert.equal(customCalls, 1)
    assert.equal(window.location.pathname, '/x')
  } finally {
    cleanup()
  }
})

test('useRouter/usePathname: push/replace/back update the shared window.history and are reflected back through usePathname', async () => {
  const { window, React, root, container, router, cleanup } = await setup('http://localhost/start')
  try {
    function Display() {
      const pathname = router.usePathname()
      const nav = router.useRouter()
      return React.createElement(
        'div',
        null,
        React.createElement('span', { key: 'p' }, pathname),
        React.createElement('button', { key: 'push', id: 'push', onClick: () => nav.push('/next') }, 'push'),
        React.createElement(
          'button',
          { key: 'replace', id: 'replace', onClick: () => nav.replace('/swapped') },
          'replace',
        ),
        React.createElement('button', { key: 'back', id: 'back', onClick: () => nav.back() }, 'back'),
      )
    }

    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    assert.equal(container.querySelector('span').textContent, '/start')

    await React.act(async () => {
      click(window, container.querySelector('#push'))
    })
    assert.equal(window.location.pathname, '/next')
    assert.equal(container.querySelector('span').textContent, '/next')

    await React.act(async () => {
      click(window, container.querySelector('#replace'))
    })
    assert.equal(window.location.pathname, '/swapped')
    assert.equal(container.querySelector('span').textContent, '/swapped')

    // back() → jsdom's history navigation settles asynchronously via 'popstate'.
    await React.act(async () => {
      click(window, container.querySelector('#back'))
      await tick(20)
    })
    assert.equal(window.location.pathname, '/start')
    assert.equal(container.querySelector('span').textContent, '/start')
  } finally {
    cleanup()
  }
})

test('useRouter: a bare browser popstate (e.g. the user clicking the real back/forward button) re-renders consumers too', async () => {
  const { window, React, root, container, router, cleanup } = await setup('http://localhost/a')
  try {
    window.history.pushState(null, '', '/b')

    function Display() {
      return React.createElement('span', null, router.usePathname())
    }
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    assert.equal(container.textContent, '/b')

    await React.act(async () => {
      window.history.pushState(null, '', '/a') // simulate having been there
      window.dispatchEvent(new window.PopStateEvent('popstate'))
    })
    // window.location itself doesn't move on a synthetic popstate (no real
    // history entry to go back to) but the manual pushState above did.
    assert.equal(container.textContent, '/a')
  } finally {
    cleanup()
  }
})

test('useParams: returns {} outside any matched dynamic route, and the provided value inside ParamsContext', async () => {
  const { React, root, container, router, cleanup } = await setup('http://localhost/')
  try {
    function Display() {
      const params = router.useParams()
      return React.createElement('span', null, JSON.stringify(params))
    }

    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    assert.equal(container.textContent, '{}')

    await React.act(async () => {
      root.render(
        React.createElement(router.ParamsContext.Provider, { value: { slug: 'hello-world' } }, React.createElement(Display)),
      )
    })
    assert.equal(container.textContent, '{"slug":"hello-world"}')
  } finally {
    cleanup()
  }
})
