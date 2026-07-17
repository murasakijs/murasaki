// Coverage for src/react/theme.tsx: <ThemeProvider>'s light/dark/system mode
// resolution, its localStorage persistence, its `data-theme` attribute
// application, useTheme(), and <T>'s tone → class mapping.
import assert from 'node:assert/strict'
import test from 'node:test'

import { installDom } from './helpers/dom.mjs'

/** A controllable `matchMedia` stand-in (jsdom doesn't implement it at all). */
function installControllableMatchMedia(dom, initialMatches = false) {
  let listeners = []
  let matches = initialMatches
  const stub = (query) => ({
    media: query,
    get matches() {
      return matches
    },
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: (_type, listener) => {
      listeners = listeners.filter((l) => l !== listener)
    },
  })
  // theme.tsx reads the bare `matchMedia`/`localStorage` identifiers (as any
  // browser script would) — in this harness that's `globalThis.matchMedia`,
  // not `window.matchMedia` (this process's `window` is a distinct jsdom
  // object, unlike a real browser where they're the same object). Set both
  // so the override is visible however the source looks it up.
  dom.window.matchMedia = stub
  globalThis.matchMedia = stub
  return {
    fireChange(next) {
      matches = next
      for (const listener of listeners) listener({ matches })
    },
  }
}

async function setup(url = 'http://localhost/') {
  const dom = installDom({ url })
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const theme = await import('../dist/react/theme.js')

  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  const root = createRoot(container)

  function Display() {
    const t = theme.useTheme()
    return React.createElement(
      'div',
      null,
      React.createElement('span', { key: 'mode', 'data-field': 'mode' }, t.mode),
      React.createElement('span', { key: 'resolved', 'data-field': 'resolved' }, t.resolved),
      React.createElement('button', { key: 'set-dark', id: 'set-dark', onClick: () => t.setMode('dark') }, 'dark'),
      React.createElement('button', { key: 'set-light', id: 'set-light', onClick: () => t.setMode('light') }, 'light'),
      React.createElement('button', { key: 'set-system', id: 'set-system', onClick: () => t.setMode('system') }, 'system'),
    )
  }

  return { ...dom, React, root, container, Display, ...theme }
}

function read(container) {
  return {
    mode: container.querySelector('[data-field="mode"]').textContent,
    resolved: container.querySelector('[data-field="resolved"]').textContent,
  }
}

function click(window, el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}

test('ThemeProvider: defaultMode "light"/"dark" resolve directly, set data-theme, and persist to localStorage', async () => {
  const { window, document, React, root, container, Display, ThemeProvider, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(ThemeProvider, { defaultMode: 'dark' }, React.createElement(Display)))
    })
    assert.deepEqual(read(container), { mode: 'dark', resolved: 'dark' })
    assert.equal(document.documentElement.dataset.theme, 'dark')
    assert.equal(window.localStorage.getItem('murasaki:theme'), 'dark')
  } finally {
    cleanup()
  }
})

test('ThemeProvider: "system" resolves from matchMedia and reacts to a live OS-preference change', async () => {
  const dom = await setup()
  const { window, document, React, root, container, Display, ThemeProvider, cleanup } = dom
  try {
    const media = installControllableMatchMedia(dom, false)

    await React.act(async () => {
      root.render(React.createElement(ThemeProvider, { defaultMode: 'system' }, React.createElement(Display)))
    })
    assert.deepEqual(read(container), { mode: 'system', resolved: 'light' })
    assert.equal(document.documentElement.dataset.theme, 'light')

    await React.act(async () => {
      media.fireChange(true)
    })
    assert.deepEqual(read(container), { mode: 'system', resolved: 'dark' })
    assert.equal(document.documentElement.dataset.theme, 'dark')
    // Still stored as "system", not the resolved concrete value.
    assert.equal(window.localStorage.getItem('murasaki:theme'), 'system')
  } finally {
    cleanup()
  }
})

test('ThemeProvider: setMode() switches mode, resolved value, data-theme, and localStorage together', async () => {
  const { window, document, React, root, container, Display, ThemeProvider, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(ThemeProvider, { defaultMode: 'light' }, React.createElement(Display)))
    })
    assert.deepEqual(read(container), { mode: 'light', resolved: 'light' })

    await React.act(async () => {
      click(window, container.querySelector('#set-dark'))
    })
    assert.deepEqual(read(container), { mode: 'dark', resolved: 'dark' })
    assert.equal(document.documentElement.dataset.theme, 'dark')
    assert.equal(window.localStorage.getItem('murasaki:theme'), 'dark')

    await React.act(async () => {
      click(window, container.querySelector('#set-light'))
    })
    assert.deepEqual(read(container), { mode: 'light', resolved: 'light' })
    assert.equal(document.documentElement.dataset.theme, 'light')
  } finally {
    cleanup()
  }
})

test('ThemeProvider: an explicit stored preference from a previous session overrides defaultMode on mount', async () => {
  const { window, React, root, container, Display, ThemeProvider, cleanup } = await setup()
  try {
    window.localStorage.setItem('murasaki:theme', 'dark')

    await React.act(async () => {
      root.render(React.createElement(ThemeProvider, { defaultMode: 'light' }, React.createElement(Display)))
    })
    assert.deepEqual(read(container), { mode: 'dark', resolved: 'dark' })
  } finally {
    cleanup()
  }
})

test('useTheme: throws when called outside of <ThemeProvider>', async () => {
  const { React, root, useTheme, cleanup } = await setup()
  try {
    // With no error boundary anywhere in the tree, a render error propagates
    // straight out of act()/render() (React 19: onCaughtError/onUncaughtError
    // are observability hooks, not something that swallows an unhandled throw).
    function Consumer() {
      useTheme()
      return null
    }
    let caught = null
    try {
      await React.act(async () => {
        root.render(React.createElement(Consumer))
      })
    } catch (err) {
      caught = err
    }
    assert.ok(caught instanceof Error)
    assert.match(caught.message, /useTheme must be inside <ThemeProvider>/)
  } finally {
    cleanup()
  }
})

test('<T>: tone maps to the documented Tailwind class combinations', async () => {
  const { React, root, container, T, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(
        React.createElement(
          'div',
          null,
          React.createElement(T, { key: 'default' }, 'Default'),
          React.createElement(T, { key: 'muted', tone: 'muted' }, 'Muted'),
          React.createElement(T, { key: 'strong', tone: 'strong' }, 'Strong'),
        ),
      )
    })
    const [defaultSpan, mutedSpan, strongSpan] = container.querySelectorAll('span')
    assert.equal(defaultSpan.className, 'text-slate-800 dark:text-slate-200')
    assert.equal(mutedSpan.className, 'text-slate-500 dark:text-slate-400')
    assert.equal(strongSpan.className, 'text-slate-900 dark:text-slate-100 font-medium')
  } finally {
    cleanup()
  }
})
