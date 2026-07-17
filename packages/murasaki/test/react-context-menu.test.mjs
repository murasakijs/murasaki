// Coverage for src/react/context-menu.tsx: `useContextMenu` (window-default
// and scoped), `<ContextMenuTrigger>` (isolation + `inherit` chaining),
// `Action.*` element serialization to the native wire shape, the
// `murasaki:menuclick` response event, and the keydown-shortcut path. Native
// IPC is a mocked `window.ipc.postMessage` (see src/react/rpc.ts's `post()`),
// same as the native side would receive it.
import assert from 'node:assert/strict'
import test from 'node:test'

import { installDom, tick } from './helpers/dom.mjs'

async function setup(url = 'http://localhost/', platform) {
  const dom = installDom({ url })
  if (platform) Object.defineProperty(dom.window.navigator, 'platform', { value: platform, configurable: true })

  const posted = []
  dom.window.ipc = { postMessage: (json) => posted.push(JSON.parse(json)) }

  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const contextMenu = await import('../dist/react/context-menu.js')
  const router = await import('../dist/react/router.js')

  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  const root = createRoot(container, { onCaughtError() {}, onUncaughtError() {} })

  return {
    ...dom,
    posted,
    React,
    root,
    container,
    ...contextMenu,
    RouterContext: router.RouterContext,
    // context-menu.tsx keeps its registry (windowMenu/scopedMenus/listener
    // refcount) as *module-level* state, shared by every test in this
    // process (dist/react/context-menu.js is only ever loaded once) — it's
    // only ever cleaned up by each useContextMenu's effect cleanup running
    // on unmount. Skipping `root.unmount()` here would leak this test's
    // menus (and its now-detached jsdom `window`'s listeners) into whichever
    // test runs next, so unmount before tearing down the jsdom window.
    async cleanup() {
      await React.act(async () => {
        root.unmount()
      })
      dom.cleanup()
    },
  }
}

function rightClick(window, el, extra = {}) {
  el.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20, ...extra }))
}

function menuClick(window, id) {
  window.dispatchEvent(new window.CustomEvent('murasaki:menuclick', { detail: id }))
}

test('useContextMenu: window-default posts the wire shape over window.ipc, with roles/accelerators/separators/custom handlers', async () => {
  const { window, React, root, posted, useContextMenu, Action, cleanup } = await setup()
  try {
    let customClicked = 0
    function App() {
      useContextMenu([
        { label: 'Reload', shortcut: 'command,R', action: React.createElement(Action.Reload) },
        { separator: true },
        { label: 'Copy', action: React.createElement(Action.Copy) },
        { label: 'Custom', action: () => customClicked++ },
        { label: 'Disabled', disabled: true, action: () => {} },
      ])
      return React.createElement('div', null, 'app')
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })
    await React.act(async () => {
      rightClick(window, window)
    })

    assert.equal(posted.length, 1)
    const payload = posted[0]
    assert.equal(payload.kind, 'contextMenu')
    assert.equal(payload.x, 10)
    assert.equal(payload.y, 20)
    assert.equal(payload.items.length, 5)
    assert.equal(payload.items[0].label, 'Reload')
    assert.equal(payload.items[0].accelerator, 'CmdOrCtrl+R')
    assert.equal(payload.items[0].role, undefined, 'Reload is a client behaviour, not a native role')
    assert.equal(payload.items[1].role, 'separator')
    assert.equal(payload.items[2].role, 'copy')
    assert.equal(payload.items[3].label, 'Custom')
    assert.equal(payload.items[4].enabled, false)

    const customId = payload.items[3].id
    await React.act(async () => {
      menuClick(window, customId)
    })
    assert.equal(customClicked, 1)
  } finally {
    await cleanup()
  }
})

test('Action.* role items (Paste/Cut/SelectAll/Undo/Redo/Quit) all serialize to their `role`', async () => {
  const { window, React, root, posted, useContextMenu, Action, cleanup } = await setup()
  try {
    function App() {
      useContextMenu([
        { label: 'Paste', action: React.createElement(Action.Paste) },
        { label: 'Cut', action: React.createElement(Action.Cut) },
        { label: 'Select All', action: React.createElement(Action.SelectAll) },
        { label: 'Undo', action: React.createElement(Action.Undo) },
        { label: 'Redo', action: React.createElement(Action.Redo) },
        { label: 'Quit', action: React.createElement(Action.Quit) },
      ])
      return null
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })
    await React.act(async () => {
      rightClick(window, window)
    })
    const roles = posted[0].items.map((i) => i.role)
    assert.deepEqual(roles, ['paste', 'cut', 'selectAll', 'undo', 'redo', 'quit'])
  } finally {
    await cleanup()
  }
})

test('Action.Navigate routes through useRouter().push (fallback path, no RouterContext)', async () => {
  const { window, React, root, posted, useContextMenu, Action, cleanup } = await setup('http://localhost/start')
  try {
    function App() {
      useContextMenu([{ label: 'Go', action: React.createElement(Action.Navigate, { to: '/elsewhere' }) }])
      return null
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })
    await React.act(async () => {
      rightClick(window, window)
    })
    const id = posted[0].items[0].id
    await React.act(async () => {
      menuClick(window, id)
    })
    assert.equal(window.location.pathname, '/elsewhere')
  } finally {
    await cleanup()
  }
})

test('Action.Navigate defers to a RouterContext when one is in scope, instead of the window.history fallback', async () => {
  const { window, React, root, posted, useContextMenu, Action, RouterContext, cleanup } = await setup('http://localhost/start')
  try {
    const pushCalls = []
    const mockRouter = { pathname: '/start', push: (to) => pushCalls.push(to), replace: () => {}, back: () => {} }
    function App() {
      useContextMenu([{ label: 'Go', action: React.createElement(Action.Navigate, { to: '/elsewhere' }) }])
      return null
    }
    await React.act(async () => {
      root.render(React.createElement(RouterContext.Provider, { value: mockRouter }, React.createElement(App)))
    })
    await React.act(async () => {
      rightClick(window, window)
    })
    await React.act(async () => {
      menuClick(window, posted[0].items[0].id)
    })
    assert.deepEqual(pushCalls, ['/elsewhere'])
    assert.equal(window.location.pathname, '/start', 'the mock router never touched window.history itself')
  } finally {
    await cleanup()
  }
})

test('Action.Run and createActions both resolve to a callable client handler', async () => {
  const { window, React, root, posted, useContextMenu, Action, createActions, cleanup } = await setup()
  try {
    let ran = 0
    let pinged = 0
    const AppActions = createActions({ ping: () => pinged++ })
    function App() {
      useContextMenu([
        { label: 'Run', action: React.createElement(Action.Run, { action: () => ran++ }) },
        { label: 'Ping', action: React.createElement(AppActions.ping) },
      ])
      return null
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })
    await React.act(async () => {
      rightClick(window, window)
    })
    const [runId, pingId] = posted[0].items.map((i) => i.id)
    await React.act(async () => {
      menuClick(window, runId)
    })
    await React.act(async () => {
      menuClick(window, pingId)
    })
    assert.equal(ran, 1)
    assert.equal(pinged, 1)
    // createActions also re-exposes the built-ins under the same object.
    assert.equal(AppActions.Copy, Action.Copy)
  } finally {
    await cleanup()
  }
})

test('Reload calls window.location.reload() (best-effort in jsdom, which cannot fully emulate it)', async () => {
  const { window, React, root, posted, useContextMenu, Action, cleanup } = await setup()
  try {
    function App() {
      useContextMenu([{ label: 'Reload', action: React.createElement(Action.Reload) }])
      return null
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })
    await React.act(async () => {
      rightClick(window, window)
    })
    const originalError = console.error
    console.error = () => {} // jsdom logs "Not implemented: navigation…" for a real reload() call
    await React.act(async () => {
      menuClick(window, posted[0].items[0].id)
    })
    console.error = originalError
  } finally {
    await cleanup()
  }
})

test('ContextMenuTrigger: a scoped menu is isolated by default — only its own items post, and stopPropagation keeps the window-default from also firing', async () => {
  const { window, React, root, container, posted, useContextMenu, ContextMenuTrigger, cleanup } = await setup()
  try {
    function App() {
      useContextMenu([{ label: 'WindowItem', action: () => {} }])
      useContextMenu('card', [{ label: 'CardItem', action: () => {} }])
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(ContextMenuTrigger, { id: 'card' }, React.createElement('div', { id: 'target' }, 'card')),
        React.createElement('div', { id: 'outside' }, 'outside'),
      )
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })

    await React.act(async () => {
      rightClick(window, container.querySelector('#target'))
    })
    assert.equal(posted.length, 1)
    assert.deepEqual(posted[0].items.map((i) => i.label), ['CardItem'])

    await React.act(async () => {
      rightClick(window, container.querySelector('#outside'))
    })
    assert.equal(posted.length, 2)
    assert.deepEqual(posted[1].items.map((i) => i.label), ['WindowItem'])
  } finally {
    await cleanup()
  }
})

test('ContextMenuTrigger: `inherit` pulls in the enclosing (app-wide) scope above its own items, separated by a divider', async () => {
  const { window, React, root, container, posted, useContextMenu, ContextMenuTrigger, cleanup } = await setup()
  try {
    function App() {
      useContextMenu([{ label: 'WindowItem', action: () => {} }])
      useContextMenu('card', [{ label: 'CardItem', action: () => {} }])
      return React.createElement(
        ContextMenuTrigger,
        { id: 'card', inherit: true },
        React.createElement('div', { id: 'target' }, 'card'),
      )
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })
    await React.act(async () => {
      rightClick(window, container.querySelector('#target'))
    })

    const items = posted[0].items
    assert.equal(items[0].label, 'WindowItem')
    assert.equal(items[1].role, 'separator')
    assert.equal(items[2].label, 'CardItem')
  } finally {
    await cleanup()
  }
})

test('ContextMenuTrigger: an unmounted scope falls back to the window-default on the next right-click', async () => {
  const { window, React, root, container, posted, useContextMenu, ContextMenuTrigger, cleanup } = await setup()
  try {
    function ScopedMenuOwner() {
      useContextMenu('card', [{ label: 'CardItem', action: () => {} }])
      return null
    }
    function App({ withScoped }) {
      useContextMenu([{ label: 'WindowItem', action: () => {} }])
      return React.createElement(
        React.Fragment,
        null,
        withScoped ? React.createElement(ScopedMenuOwner) : null,
        React.createElement(ContextMenuTrigger, { id: 'card' }, React.createElement('div', { id: 'target' }, 'card')),
      )
    }
    await React.act(async () => {
      root.render(React.createElement(App, { withScoped: true }))
    })
    await React.act(async () => {
      rightClick(window, container.querySelector('#target'))
    })
    assert.deepEqual(posted.at(-1).items.map((i) => i.label), ['CardItem'])

    await React.act(async () => {
      root.render(React.createElement(App, { withScoped: false }))
    })
    await React.act(async () => {
      rightClick(window, container.querySelector('#target'))
    })
    assert.deepEqual(posted.at(-1).items.map((i) => i.label), ['WindowItem'])
  } finally {
    await cleanup()
  }
})

test('useContextMenu: mounting two window-default menus warns, and the last-mounted one wins', async () => {
  const { window, React, root, posted, useContextMenu, cleanup } = await setup()
  try {
    function First() {
      useContextMenu([{ label: 'First', action: () => {} }])
      return null
    }
    function Second() {
      useContextMenu([{ label: 'Second', action: () => {} }])
      return null
    }
    const warnings = []
    const originalWarn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    await React.act(async () => {
      root.render(React.createElement(React.Fragment, null, React.createElement(First), React.createElement(Second)))
    })
    console.warn = originalWarn

    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /more than one window-default useContextMenu\(\) is mounted/)

    await React.act(async () => {
      rightClick(window, window)
    })
    assert.deepEqual(posted[0].items.map((i) => i.label), ['Second'])
  } finally {
    await cleanup()
  }
})

test('keyboard shortcuts fire the action straight off keydown, without the menu ever opening — modifier resolution is platform-aware', async () => {
  const { window, React, root, posted, useContextMenu, cleanup } = await setup('http://localhost/', 'MacIntel')
  try {
    let reloadCalls = 0
    function App() {
      useContextMenu([{ label: 'Reload', shortcut: 'command,R', action: () => reloadCalls++ }])
      return null
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })

    // Mac: `command` maps to metaKey.
    await React.act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true, cancelable: true }))
    })
    assert.equal(reloadCalls, 1)
    assert.equal(posted.length, 0, 'the shortcut never opened the native menu')

    // Wrong modifier for this platform — must not fire.
    await React.act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    assert.equal(reloadCalls, 1)
  } finally {
    await cleanup()
  }
})

test('keyboard shortcuts: an IME composition keydown (keyCode 229) never fires the shortcut', async () => {
  const { window, React, root, useContextMenu, cleanup } = await setup('http://localhost/', 'MacIntel')
  try {
    let reloadCalls = 0
    function App() {
      useContextMenu([{ label: 'Reload', shortcut: 'command,R', action: () => reloadCalls++ }])
      return null
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })
    await React.act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'r', metaKey: true, keyCode: 229, bubbles: true, cancelable: true }),
      )
    })
    assert.equal(reloadCalls, 0)
  } finally {
    await cleanup()
  }
})

test('the murasaki:menuclick response only invokes the handler that owns the clicked id, even across window + multiple scoped menus', async () => {
  const { window, React, root, container, posted, useContextMenu, ContextMenuTrigger, cleanup } = await setup()
  try {
    let windowClicked = 0
    let cardClicked = 0
    function App() {
      useContextMenu([{ label: 'WindowItem', action: () => windowClicked++ }])
      useContextMenu('card', [{ label: 'CardItem', action: () => cardClicked++ }])
      return React.createElement(
        ContextMenuTrigger,
        { id: 'card' },
        React.createElement('div', { id: 'target' }, 'card'),
      )
    }
    await React.act(async () => {
      root.render(React.createElement(App))
    })
    await React.act(async () => {
      rightClick(window, container.querySelector('#target'))
    })
    const cardId = posted[0].items[0].id

    await React.act(async () => {
      menuClick(window, cardId)
    })
    assert.deepEqual([windowClicked, cardClicked], [0, 1])

    // An id belonging to no live menu (e.g. a stale/unknown id) is simply ignored.
    await React.act(async () => {
      menuClick(window, 'not-a-real-id')
    })
    assert.deepEqual([windowClicked, cardClicked], [0, 1])
  } finally {
    await cleanup()
  }
})
