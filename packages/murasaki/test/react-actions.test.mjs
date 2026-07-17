// Coverage for src/react/actions.ts: `defineAction`/`callAction` (thin
// passthroughs) and `useAction` (React 19's useActionState) driven through a
// full form-submission cycle against a mocked global `fetch` that speaks the
// same wire-encoded response shape the real `/__murasaki/action/*` transport
// uses (see server-actions-wire.test.mjs / src/vite-plugin/server-actions.ts's
// generated client stub, which this test's `callServerAction` helper mirrors).
import assert from 'node:assert/strict'
import test from 'node:test'

import { installDom, tick } from './helpers/dom.mjs'
import { stringifyWire, parseWire, WIRE_CONTENT_TYPE } from '../dist/runtime/wire.js'

test('defineAction is an identity passthrough', async () => {
  const { defineAction } = await import('../dist/react/actions.js')
  async function fn() {
    return 1
  }
  assert.equal(defineAction(fn), fn)
})

test('callAction invokes the action with the given arguments and returns its result', async () => {
  const { callAction } = await import('../dist/react/actions.js')
  const result = await callAction(async (a, b) => a + b, 1, 2)
  assert.equal(result, 3)
})

/** Mirrors the client stub the server-actions vite plugin generates for a `'use server'` export. */
async function callServerAction(name, args) {
  const res = await fetch(`/__murasaki/action/test-actions.ts/${name}`, {
    method: 'POST',
    headers: { 'content-type': WIRE_CONTENT_TYPE },
    body: await stringifyWire({ args }),
  })
  const payload = parseWire(await res.text())
  if (!payload.ok) {
    throw payload.error instanceof Error ? payload.error : new Error(String(payload.error))
  }
  return payload.value
}

async function greetAction(_prevState, formData) {
  try {
    const value = await callServerAction('greet', [formData.get('name')])
    return { data: value, error: null, isPending: false }
  } catch (err) {
    return { data: null, error: err.message, isPending: false }
  }
}

async function setup(url = 'http://localhost/') {
  const dom = installDom({ url })
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useAction } = await import('../dist/react/actions.js')

  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  const root = createRoot(container)

  return { ...dom, React, root, container, useAction }
}

function harness(React, useAction, action, initial) {
  return function Harness() {
    const [state, formAction, isPending] = useAction(action, initial)
    return React.createElement(
      'form',
      { action: formAction },
      React.createElement('input', { name: 'name', defaultValue: 'Murasaki' }),
      React.createElement('button', { type: 'submit' }, 'Go'),
      React.createElement('pre', { id: 'out' }, JSON.stringify({ state, isPending })),
    )
  }
}

function readOut(container) {
  return JSON.parse(container.querySelector('#out').textContent)
}

test('useAction: a full submit cycle resolves through the mocked wire transport', async () => {
  const { window, React, root, container, useAction, cleanup } = await setup()
  try {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      const body = await stringifyWire({ ok: true, value: { greeting: 'hello Murasaki' } })
      return { ok: true, status: 200, text: async () => body }
    }

    const Harness = harness(React, useAction, greetAction, { data: null, error: null, isPending: false })
    await React.act(async () => {
      root.render(React.createElement(Harness))
    })
    assert.deepEqual(readOut(container), { state: { data: null, error: null, isPending: false }, isPending: false })

    await React.act(async () => {
      container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      await tick(10)
    })

    assert.deepEqual(readOut(container), {
      state: { data: { greeting: 'hello Murasaki' }, error: null, isPending: false },
      isPending: false,
    })

    globalThis.fetch = originalFetch
  } finally {
    cleanup()
  }
})

test('useAction: exposes a pending state while the action is in flight', async () => {
  const { window, React, root, container, useAction, cleanup } = await setup()
  try {
    const originalFetch = globalThis.fetch
    let resolveFetch
    globalThis.fetch = () => new Promise((resolve) => (resolveFetch = resolve))

    const Harness = harness(React, useAction, greetAction, { data: null, error: null, isPending: false })
    await React.act(async () => {
      root.render(React.createElement(Harness))
    })

    await React.act(async () => {
      container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    })
    // The 3rd `useActionState` tuple element flips true while in flight...
    assert.equal(readOut(container).isPending, true)
    // ...independent of the ActionState value's own `isPending` field, which
    // this action (like the framework's own example, examples/local-signal's
    // health-action.ts) always resolves as `false` — the real signal is the
    // hook's own `isPending`, not a field on the resolved state. Not a bug,
    // just worth pinning down: `ActionState.isPending` is never read by
    // `useAction` itself, only ever set by the action author.
    assert.equal(readOut(container).state.isPending, false)

    await React.act(async () => {
      const body = await stringifyWire({ ok: true, value: { greeting: 'hi' } })
      resolveFetch({ ok: true, status: 200, text: async () => body })
      await tick(10)
    })
    assert.equal(readOut(container).isPending, false)
    assert.deepEqual(readOut(container).state.data, { greeting: 'hi' })

    globalThis.fetch = originalFetch
  } finally {
    cleanup()
  }
})

test('useAction: a structured server-side error propagates into ActionState.error', async () => {
  const { window, React, root, container, useAction, cleanup } = await setup()
  try {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      const body = await stringifyWire({ ok: false, error: new Error('greet failed: invalid name') })
      return { ok: false, status: 500, text: async () => body }
    }

    const Harness = harness(React, useAction, greetAction, { data: null, error: null, isPending: false })
    await React.act(async () => {
      root.render(React.createElement(Harness))
    })
    await React.act(async () => {
      container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      await tick(10)
    })

    const out = readOut(container)
    assert.equal(out.state.data, null)
    assert.equal(out.state.error, 'greet failed: invalid name')
    assert.equal(out.isPending, false)

    globalThis.fetch = originalFetch
  } finally {
    cleanup()
  }
})

test('useAction: a transport-level failure (network error) also surfaces as ActionState.error', async () => {
  const { window, React, root, container, useAction, cleanup } = await setup()
  try {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }

    const Harness = harness(React, useAction, greetAction, { data: null, error: null, isPending: false })
    await React.act(async () => {
      root.render(React.createElement(Harness))
    })
    await React.act(async () => {
      container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      await tick(10)
    })

    const out = readOut(container)
    assert.equal(out.state.data, null)
    assert.equal(out.state.error, 'fetch failed')

    globalThis.fetch = originalFetch
  } finally {
    cleanup()
  }
})

test('useAction: request payload is wire-encoded (not plain JSON), matching the real transport contract', async () => {
  const { window, React, root, container, useAction, cleanup } = await setup()
  try {
    const originalFetch = globalThis.fetch
    let capturedBody
    globalThis.fetch = async (url, init) => {
      capturedBody = init.body
      const body = await stringifyWire({ ok: true, value: { greeting: 'ok' } })
      return { ok: true, status: 200, text: async () => body }
    }

    const Harness = harness(React, useAction, greetAction, { data: null, error: null, isPending: false })
    await React.act(async () => {
      root.render(React.createElement(Harness))
    })
    await React.act(async () => {
      container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      await tick(10)
    })

    // The body carries the wire codec's envelope (a version marker + a
    // reference-graph encoding), not a plain `JSON.stringify({ args })`.
    assert.equal(JSON.parse(capturedBody).$murasakiWire, 1)
    const decoded = parseWire(capturedBody)
    assert.deepEqual(decoded.args, ['Murasaki'])

    globalThis.fetch = originalFetch
  } finally {
    cleanup()
  }
})
