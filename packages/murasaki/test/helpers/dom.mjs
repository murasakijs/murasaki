// Shared jsdom bootstrap for the src/react/** test files.
//
// `node --test` runs each matched file in its own process (confirmed by the
// package's `test` script: `node --test test/*.test.mjs`), so installing
// globals here — once per file, at module load — can't leak state into the
// non-DOM test files (server/runtime/etc.) that never import this helper.
//
// jsdom doesn't implement everything a browser does (`matchMedia`,
// `EventSource`, real navigation…) — `installDom` stubs the couple of things
// murasaki's react layer touches so tests don't have to special-case every
// file. Anything more exotic (a fake `EventSource` for the updater, a fake
// `window.ipc` for context-menu/app-menu) is installed by the test file that
// needs it, on top of this base.
import { JSDOM } from 'jsdom'

const GLOBAL_KEYS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'PopStateEvent',
  'MessageEvent',
  'EventTarget',
  'DocumentFragment',
  'FormData',
  'File',
  'Blob',
  'getComputedStyle',
  'matchMedia',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]

/**
 * Installs a fresh jsdom window as the global browser environment and
 * returns `{ window, document, cleanup() }`. Also flips on
 * `IS_REACT_ACT_ENVIRONMENT` so React's `act()` doesn't warn.
 *
 * Call `cleanup()` in a `test.after`/`afterEach` to tear the window down and
 * restore whatever globals existed before (there shouldn't be any in this
 * suite, but it keeps re-entrant use — e.g. one helper per `test()` — safe).
 */
export function installDom({ url = 'http://localhost/' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url,
    pretendToBeVisual: true,
  })
  const { window } = dom

  // jsdom doesn't implement matchMedia — theme.tsx's system-preference
  // listener needs a minimal stand-in.
  window.matchMedia = window.matchMedia ?? ((query) => stubMediaQueryList(query))

  const saved = new Map()
  for (const key of GLOBAL_KEYS) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    // Some globals (e.g. Node's own `navigator`) are getter-only own
    // properties — a plain `globalThis[key] = …` assignment throws in
    // strict-mode ESM. `defineProperty` overwrites them unconditionally.
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? window : window[key],
      writable: true,
      configurable: true,
      enumerable: true,
    })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  return {
    window,
    document: window.document,
    cleanup() {
      for (const key of GLOBAL_KEYS) {
        const descriptor = saved.get(key)
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
      delete globalThis.IS_REACT_ACT_ENVIRONMENT
      window.close()
    },
  }
}

function stubMediaQueryList(query) {
  const listeners = new Set()
  return {
    media: query,
    matches: false,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    dispatchEvent() {
      return true
    },
  }
}

/** Resolves once `target` fires `type`, or after `timeoutMs` (whichever first). */
export function waitForEvent(target, type, timeoutMs = 200) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs)
    target.addEventListener(
      type,
      (event) => {
        clearTimeout(timer)
        resolve(event)
      },
      { once: true },
    )
  })
}

/** Waits a macrotask tick (enough for jsdom's async history/navigation plumbing to settle). */
export function tick(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
