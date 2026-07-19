import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})

const exposedGlobals = [
  'window',
  'document',
  'navigator',
  'Node',
  'NodeFilter',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'SVGElement',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'PointerEvent',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]

for (const key of exposedGlobals) {
  const value = key === 'window'
    ? dom.window
    : key === 'PointerEvent'
      ? dom.window.PointerEvent ?? dom.window.MouseEvent
      : dom.window[key]
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
  })
}

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
  if (!HTMLElement.prototype[method]) {
    Object.defineProperty(HTMLElement.prototype, method, {
      value: method === 'hasPointerCapture' ? () => false : () => {},
      configurable: true,
    })
  }
}
HTMLElement.prototype.scrollIntoView ??= () => {}

const React = await import('react')
const { act, createElement: h } = React
const { createRoot } = await import('react-dom/client')
const UI = await import('../dist/index.js')

async function mount(element) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container, { onCaughtError() {}, onUncaughtError() {} })
  await act(async () => root.render(element))
  return {
    container,
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
  })
}

function press(target, key) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

test('Tabs support pointer and keyboard selection with synchronized ARIA state', async (t) => {
  const view = await mount(
    h(UI.Tabs, { defaultValue: 'preview', activationMode: 'manual' },
      h(UI.TabsList, { 'aria-label': 'View source' },
        h(UI.TabsTrigger, { value: 'preview' }, 'Preview'),
        h(UI.TabsTrigger, { value: 'code' }, 'Code'),
      ),
      h(UI.TabsContent, { value: 'preview' }, 'Rendered application'),
      h(UI.TabsContent, { value: 'code' }, 'Source code'),
    ),
  )
  t.after(() => view.unmount())

  const [preview, code] = view.container.querySelectorAll('[role="tab"]')
  assert.equal(preview.getAttribute('aria-selected'), 'true')
  assert.match(view.container.textContent, /Rendered application/)
  assert.doesNotMatch(view.container.textContent, /Source code/)

  await act(async () => {
    code.dispatchEvent(new MouseEvent('mousedown', {
      button: 0,
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    }))
  })
  await settle()
  assert.equal(code.getAttribute('aria-selected'), 'true')
  assert.equal(preview.getAttribute('aria-selected'), 'false')
  assert.match(view.container.textContent, /Source code/)

  await act(async () => preview.focus())
  await act(async () => press(preview, 'Enter'))
  await settle()
  assert.equal(document.activeElement, preview)
  assert.equal(preview.getAttribute('aria-selected'), 'true')
})

test('Dialog portals content, closes on Escape, and restores trigger focus', async (t) => {
  const view = await mount(
    h(UI.Dialog, null,
      h(UI.DialogTrigger, null, 'Open settings'),
      h(UI.DialogContent, null,
        h(UI.DialogTitle, null, 'Settings'),
        h(UI.DialogDescription, null, 'Change application settings'),
        h('button', { type: 'button' }, 'Save'),
      ),
    ),
  )
  t.after(() => view.unmount())

  const trigger = view.container.querySelector('button')
  await act(async () => trigger.focus())
  await act(async () => trigger.click())
  await settle()

  const dialog = document.body.querySelector('[role="dialog"]')
  assert.ok(dialog, 'dialog content must be portalled into document.body')
  assert.equal(dialog.getAttribute('data-state'), 'open')
  assert.match(dialog.textContent, /Change application settings/)
  assert.ok(dialog.contains(document.activeElement), 'focus must move inside the open dialog')

  await act(async () => press(document.activeElement, 'Escape'))
  await settle()
  assert.equal(document.body.querySelector('[role="dialog"]'), null)
  assert.equal(document.activeElement, trigger)
})

test('DropdownMenu supports keyboard open, item activation, and focus restoration', async (t) => {
  let selected = 0
  const view = await mount(
    h(UI.DropdownMenu, null,
      h(UI.DropdownMenuTrigger, null, 'Actions'),
      h(UI.DropdownMenuContent, null,
        h(UI.DropdownMenuItem, { onSelect: () => selected++ }, 'Duplicate'),
        h(UI.DropdownMenuItem, null, 'Archive'),
      ),
    ),
  )
  t.after(() => view.unmount())

  const trigger = view.container.querySelector('button')
  await act(async () => trigger.focus())
  await act(async () => press(trigger, 'ArrowDown'))
  await settle()

  const menu = document.body.querySelector('[role="menu"]')
  assert.ok(menu)
  const items = menu.querySelectorAll('[role="menuitem"]')
  assert.equal(items.length, 2)
  assert.equal(document.activeElement, items[0])

  await act(async () => press(items[0], 'Enter'))
  await settle()
  assert.equal(selected, 1)
  assert.equal(document.body.querySelector('[role="menu"]'), null)
  assert.equal(document.activeElement, trigger)
})
