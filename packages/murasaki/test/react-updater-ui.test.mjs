// Coverage for src/react/updater.tsx's `useUpdate()`: SSE-driven state
// (`/__murasaki/update/events`), the check()/download()/install() POSTs, and
// install()'s success → quit() handoff. jsdom doesn't implement `EventSource`
// at all, so this file installs a small fake on both `window` and
// `globalThis` (updater.tsx reads the bare `EventSource` identifier, which in
// this harness resolves through `globalThis`, not `window` — see
// react-theme.test.mjs's `matchMedia` note for the same `window`-vs-
// `globalThis` split).
import assert from 'node:assert/strict'
import test from 'node:test'

import { installDom, tick } from './helpers/dom.mjs'

class FakeEventSource {
  constructor(url) {
    this.url = url
    this.onmessage = null
    this.onerror = null
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  /** Emits a well-formed `UpdateState` SSE frame. */
  emit(state) {
    this.onmessage?.({ data: JSON.stringify(state) })
  }
  /** Emits a raw (possibly malformed) frame body. */
  emitRaw(data) {
    this.onmessage?.({ data })
  }
  close() {
    this.closed = true
  }
}

async function setup(url = 'http://localhost/') {
  const dom = installDom({ url })
  FakeEventSource.instances = []
  dom.window.EventSource = FakeEventSource
  globalThis.EventSource = FakeEventSource

  const fetchCalls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (requestUrl, init) => {
    fetchCalls.push({ url: requestUrl, method: init?.method })
    return dom.nextFetchResponse ? dom.nextFetchResponse(requestUrl, init) : { ok: true }
  }

  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useUpdate } = await import('../dist/react/updater.js')

  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  const root = createRoot(container, { onCaughtError() {}, onUncaughtError() {} })

  function Display() {
    const u = useUpdate()
    return React.createElement(
      'div',
      null,
      React.createElement(
        'pre',
        { id: 'out' },
        JSON.stringify({
          status: u.status,
          current: u.current,
          latest: u.latest,
          notes: u.notes,
          mandatory: u.mandatory,
          progress: u.progress,
          error: u.error,
        }),
      ),
      React.createElement('button', { id: 'check', onClick: u.check }, 'check'),
      React.createElement('button', { id: 'download', onClick: u.download }, 'download'),
      React.createElement('button', { id: 'install', onClick: u.install }, 'install'),
      React.createElement('button', { id: 'dismiss', onClick: u.dismiss }, 'dismiss'),
    )
  }

  return {
    ...dom,
    React,
    root,
    container,
    Display,
    fetchCalls,
    async cleanup() {
      await React.act(async () => {
        root.unmount()
      })
      globalThis.fetch = originalFetch
      delete globalThis.EventSource
      dom.cleanup()
    },
  }
}

function read(container) {
  return JSON.parse(container.querySelector('#out').textContent)
}

function click(window, el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}

test('useUpdate: connects to the SSE events endpoint on mount, defaulting to idle/0.0.0', async () => {
  const { React, root, container, Display, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    assert.deepEqual(read(container).status, 'idle')
    assert.equal(read(container).current, '0.0.0')
    assert.equal(FakeEventSource.instances.length, 1)
    assert.equal(FakeEventSource.instances[0].url, '/__murasaki/update/events')
  } finally {
    await cleanup()
  }
})

test('useUpdate: `current` comes from the injected __MURASAKI_VERSION__ build constant when present', async () => {
  const { React, root, container, Display, cleanup } = await setup()
  try {
    globalThis.__MURASAKI_VERSION__ = '1.2.3'
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    assert.equal(read(container).current, '1.2.3')
  } finally {
    delete globalThis.__MURASAKI_VERSION__
    await cleanup()
  }
})

test('useUpdate: mirrors every SSE frame verbatim through the full checking→available→downloading→ready lifecycle', async () => {
  const { React, root, container, Display, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    const source = FakeEventSource.instances[0]

    await React.act(async () => {
      source.emit({ status: 'checking', current: '1.0.0' })
    })
    assert.equal(read(container).status, 'checking')

    await React.act(async () => {
      source.emit({ status: 'available', current: '1.0.0', latest: '1.1.0', notes: 'Bug fixes', mandatory: false })
    })
    assert.deepEqual(read(container), {
      status: 'available',
      current: '1.0.0',
      latest: '1.1.0',
      notes: 'Bug fixes',
      mandatory: false,
    })

    await React.act(async () => {
      source.emit({ status: 'downloading', current: '1.0.0', latest: '1.1.0', progress: 0.42 })
    })
    assert.equal(read(container).status, 'downloading')
    assert.equal(read(container).progress, 0.42)

    await React.act(async () => {
      source.emit({ status: 'ready', current: '1.0.0', latest: '1.1.0' })
    })
    assert.equal(read(container).status, 'ready')
  } finally {
    await cleanup()
  }
})

test('useUpdate: an SSE frame fully replaces the state (not a merge) — a later frame drops fields the previous one had', async () => {
  const { React, root, container, Display, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    const source = FakeEventSource.instances[0]
    await React.act(async () => {
      source.emit({ status: 'downloading', current: '1.0.0', latest: '1.1.0', progress: 0.9 })
    })
    assert.equal(read(container).progress, 0.9)

    // The next frame doesn't mention `progress` at all — it's gone, not preserved.
    await React.act(async () => {
      source.emit({ status: 'ready', current: '1.0.0', latest: '1.1.0' })
    })
    assert.equal(read(container).progress, undefined)
  } finally {
    await cleanup()
  }
})

test('useUpdate: a malformed SSE frame is ignored, and the next well-formed frame resyncs normally', async () => {
  const { React, root, container, Display, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    const source = FakeEventSource.instances[0]

    await React.act(async () => {
      source.emitRaw('not valid json{{{')
    })
    assert.equal(read(container).status, 'idle', 'unchanged by the malformed frame')

    await React.act(async () => {
      source.emit({ status: 'available', current: '1.0.0', latest: '2.0.0' })
    })
    assert.equal(read(container).status, 'available')
  } finally {
    await cleanup()
  }
})

test('useUpdate: unmounting closes the SSE connection', async () => {
  const { React, root, container, Display, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    const source = FakeEventSource.instances[0]
    assert.equal(source.closed, false)
    await React.act(async () => {
      root.unmount()
    })
    assert.equal(source.closed, true)
  } finally {
    await cleanup()
  }
})

test('useUpdate: check() and download() POST to their respective endpoints', async () => {
  const { window, React, root, container, Display, fetchCalls, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    await React.act(async () => {
      click(window, container.querySelector('#check'))
    })
    await React.act(async () => {
      click(window, container.querySelector('#download'))
    })
    assert.deepEqual(fetchCalls, [
      { url: '/__murasaki/update/check', method: 'POST' },
      { url: '/__murasaki/update/download', method: 'POST' },
    ])
  } finally {
    await cleanup()
  }
})

test('useUpdate: check()/download() surface a transport failure as status "error" with the error message', async () => {
  const { window, React, root, container, Display, cleanup } = await setup()
  try {
    globalThis.fetch = async () => {
      throw new TypeError('network down')
    }
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    await React.act(async () => {
      click(window, container.querySelector('#check'))
      await tick(10)
    })
    assert.equal(read(container).status, 'error')
    assert.equal(read(container).error, 'network down')
  } finally {
    await cleanup()
  }
})

test('useUpdate: dismiss() resets status to idle without touching other fields', async () => {
  const { window, React, root, container, Display, cleanup } = await setup()
  try {
    await React.act(async () => {
      root.render(React.createElement(Display))
    })
    const source = FakeEventSource.instances[0]
    await React.act(async () => {
      source.emit({ status: 'error', current: '1.0.0', error: 'boom' })
    })
    assert.equal(read(container).status, 'error')

    await React.act(async () => {
      click(window, container.querySelector('#dismiss'))
    })
    assert.equal(read(container).status, 'idle')
    // NOTE: dismiss() only overwrites `status` (`{ ...s, status: 'idle' }`) —
    // the stale `error` string from the last SSE frame survives until the
    // next SSE frame replaces the whole state wholesale. Documented as
    // observed behavior, not asserted as ideal.
    assert.equal(read(container).error, 'boom')
  } finally {
    await cleanup()
  }
})

test('useUpdate: install() POSTs, and only quits the app (via the native bridge) once the backend confirms the handoff', async () => {
  const { window, React, root, container, Display, cleanup } = await setup()
  try {
    let installOk = true
    globalThis.fetch = async (requestUrl, init) => {
      if (requestUrl === '/__murasaki/update/install') return { ok: installOk }
      return { ok: true }
    }
    const nativeCalls = []
    window.ipc = {
      postMessage: (raw) => {
        const message = JSON.parse(raw)
        nativeCalls.push(message)
        if (message.kind === 'nativeCall') {
          queueMicrotask(() => {
            window.dispatchEvent(
              new window.CustomEvent('murasaki:nativeresponse', {
                detail: { requestId: message.requestId, response: { ok: true, value: undefined } },
              }),
            )
          })
        }
      },
    }

    await React.act(async () => {
      root.render(React.createElement(Display))
    })

    await React.act(async () => {
      click(window, container.querySelector('#install'))
      await tick(20)
    })
    assert.equal(nativeCalls.length, 1)
    assert.equal(nativeCalls[0].method, 'app.quit')

    installOk = false
    nativeCalls.length = 0
    await React.act(async () => {
      click(window, container.querySelector('#install'))
      await tick(20)
    })
    assert.equal(nativeCalls.length, 0, 'a non-ok install response never triggers quit()')
  } finally {
    await cleanup()
  }
})
