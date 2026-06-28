// murasaki/jsx/dom — client-side runtime.
//
// Design notes (MVP):
// - Naive: every state change triggers a full re-render of the root.
//   No virtual-DOM diff, no fiber. Good enough for desktop apps where
//   trees are tiny and re-render is sub-millisecond.
// - Hooks: useState / useEffect / useRef. Indexed by "component slot"
//   in render order — same as React's call-order rule, so the usual
//   "no hooks in conditionals" applies.
// - Events: any prop starting with "on" + a function becomes a DOM
//   event listener. Names normalize: onClick → "click", onChange → "change".
// - HMR friendly: createRoot re-uses the same container, just clears + remounts.
//
// This file is browser-only. It uses `document`, `window`, etc., so it must
// only be loaded via the client bundle — never imported on the Node side.

// ── JSX node shape (mirrors the SSR runtime, kept locally to avoid
// dragging Node-only code into the browser bundle) ──────────────────
type Props = Record<string, unknown>
type Component = (props: Props) => Child
type Child = string | number | bigint | boolean | null | undefined | JSXNodeLike | Child[]

interface JSXNodeLike {
  readonly __isJSXNode: true
  tag: string | Component
  props: Props
  children: Child[]
  toString?: () => string
}

class JSXNode implements JSXNodeLike {
  readonly __isJSXNode = true as const
  constructor(
    public tag: string | Component,
    public props: Props,
    public children: Child[],
  ) {}
}

function isJSXNode(v: unknown): v is JSXNode {
  return typeof v === 'object' && v !== null && (v as JSXNodeLike).__isJSXNode === true
}

// ── jsx() factory ────────────────────────────────────────────────────
export function jsx(tag: string | Component, props: Props | null): JSXNode {
  const p = (props ?? {}) as Props & { children?: Child }
  const rawChildren = p.children
  const children: Child[] = Array.isArray(rawChildren)
    ? rawChildren
    : rawChildren != null
      ? [rawChildren]
      : []
  const { children: _drop, ...rest } = p
  return new JSXNode(tag, rest, children)
}
export const jsxs = jsx
export const jsxDEV = jsx
export const createElement = jsx

export function Fragment(props: { children?: Child }): Child {
  return props.children ?? null
}

// ── Hook state (per-root, per-component-instance) ────────────────────
type ComponentSlot = {
  states: unknown[]
  effects: Array<{ deps: unknown[] | undefined; cleanup?: () => void; pending?: () => void }>
  refs: Array<{ current: unknown }>
}

type RootState = {
  container: HTMLElement
  render: () => Child
  slots: Map<string, ComponentSlot>
  currentSlotKey: string
  currentSlot: ComponentSlot | null
  stateIdx: number
  effectIdx: number
  refIdx: number
  rendering: boolean
  pendingRender: boolean
}

let currentRoot: RootState | null = null

function getOrInitSlot(key: string): ComponentSlot {
  const slots = currentRoot!.slots
  let slot = slots.get(key)
  if (!slot) {
    slot = { states: [], effects: [], refs: [] }
    slots.set(key, slot)
  }
  return slot
}

// ── useState ─────────────────────────────────────────────────────────
// Behavior on the server (no active root): returns the initial value with
// a no-op setter, so user code can be imported and SSR-rendered safely.
export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const root = currentRoot
  if (!root || !root.currentSlot) {
    const v = typeof initial === 'function' ? (initial as () => T)() : initial
    return [v, () => {}]
  }
  const slot = root.currentSlot
  const idx = root.stateIdx++
  if (idx >= slot.states.length) {
    slot.states[idx] = typeof initial === 'function' ? (initial as () => T)() : initial
  }
  const set = (next: T | ((prev: T) => T)) => {
    const prev = slot.states[idx] as T
    const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
    if (Object.is(prev, value)) return
    slot.states[idx] = value
    scheduleRender(root)
  }
  return [slot.states[idx] as T, set]
}

// ── useEffect (basic: deps-based; no-op on server) ──────────────────
export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void {
  const root = currentRoot
  if (!root || !root.currentSlot) return
  const slot = root.currentSlot
  const idx = root.effectIdx++
  const prev = slot.effects[idx]
  const changed =
    !prev ||
    !deps ||
    !prev.deps ||
    deps.length !== prev.deps.length ||
    deps.some((d, i) => !Object.is(d, prev.deps?.[i]))
  if (changed) {
    slot.effects[idx] = {
      deps,
      cleanup: prev?.cleanup,
      pending: () => {
        prev?.cleanup?.()
        const ret = fn()
        if (typeof ret === 'function') {
          slot.effects[idx].cleanup = ret
        } else {
          slot.effects[idx].cleanup = undefined
        }
      },
    }
  }
}

// ── useRef (no-op-ish on server: returns a fresh ref every render) ──
export function useRef<T>(initial: T): { current: T } {
  const root = currentRoot
  if (!root || !root.currentSlot) return { current: initial }
  const slot = root.currentSlot
  const idx = root.refIdx++
  if (idx >= slot.refs.length) {
    slot.refs[idx] = { current: initial }
  }
  return slot.refs[idx] as { current: T }
}

// ── Schedule a re-render (microtask coalesce) ────────────────────────
function scheduleRender(root: RootState) {
  if (root.rendering) {
    root.pendingRender = true
    return
  }
  root.pendingRender = true
  queueMicrotask(() => {
    if (root.pendingRender) {
      root.pendingRender = false
      mount(root)
    }
  })
}

// ── Attribute helpers ────────────────────────────────────────────────
const ATTR_ALIAS: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  charSet: 'charset',
}

function camelToKebab(k: string): string {
  if (k[0] === '-' || !/[A-Z]/.test(k)) return k
  return k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function styleObjToCss(obj: Record<string, unknown>): string {
  let out = ''
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === false) continue
    let val: string
    if (typeof v === 'number') val = `${v}px`
    else if (typeof v === 'string') val = v
    else continue
    out += `${out ? ';' : ''}${camelToKebab(k)}:${val}`
  }
  return out
}

// ── DOM materializer ────────────────────────────────────────────────
function appendChild(parent: Node, child: Child, slotKey: string) {
  if (child == null || child === false || child === true) return
  if (typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint') {
    parent.appendChild(document.createTextNode(String(child)))
    return
  }
  if (Array.isArray(child)) {
    child.forEach((c, i) => appendChild(parent, c, `${slotKey}.${i}`))
    return
  }
  if (isJSXNode(child)) {
    parent.appendChild(toDOM(child, slotKey))
  }
}

function toDOM(node: JSXNode, slotKey: string): Node {
  const { tag, props, children } = node

  // Component / Fragment
  if (typeof tag === 'function') {
    const root = currentRoot!
    const prevSlot = root.currentSlot
    const prevKey = root.currentSlotKey
    const prevStateIdx = root.stateIdx
    const prevEffectIdx = root.effectIdx
    const prevRefIdx = root.refIdx

    const key = `${slotKey}|${tag.name || 'Anon'}`
    root.currentSlotKey = key
    root.currentSlot = getOrInitSlot(key)
    root.stateIdx = 0
    root.effectIdx = 0
    root.refIdx = 0

    const result = tag({ ...props, children: children.length === 1 ? children[0] : children })

    root.currentSlot = prevSlot
    root.currentSlotKey = prevKey
    root.stateIdx = prevStateIdx
    root.effectIdx = prevEffectIdx
    root.refIdx = prevRefIdx

    const frag = document.createDocumentFragment()
    appendChild(frag, result, key)
    return frag
  }

  // Intrinsic element
  const el = document.createElement(tag)
  for (const k in props) {
    const v = props[k]
    if (k === 'children' || k === 'key' || k === 'ref') continue
    if (v == null || v === false) continue

    // Event handler: onClick, onChange, onInput, ...
    if (k.length > 2 && k[0] === 'o' && k[1] === 'n' && typeof v === 'function') {
      const eventName = k.slice(2).toLowerCase()
      el.addEventListener(eventName, v as EventListener)
      continue
    }

    // dangerouslySetInnerHTML
    if (k === 'dangerouslySetInnerHTML') {
      const html = (v as { __html?: string }).__html
      if (typeof html === 'string') el.innerHTML = html
      continue
    }

    // Style object
    if (k === 'style' && typeof v === 'object') {
      el.setAttribute('style', styleObjToCss(v as Record<string, unknown>))
      continue
    }

    const name = ATTR_ALIAS[k] || k
    if (v === true) {
      el.setAttribute(name, '')
    } else {
      el.setAttribute(name, String(v))
    }
  }

  children.forEach((c, i) => appendChild(el, c, `${slotKey}>${tag}.${i}`))
  return el
}

// ── Mount (initial + re-render) ──────────────────────────────────────
function mount(root: RootState) {
  root.rendering = true
  currentRoot = root
  root.currentSlotKey = ''
  root.currentSlot = null
  root.stateIdx = 0
  root.effectIdx = 0
  root.refIdx = 0

  // Render tree
  const tree = root.render()

  // Wipe container + re-fill
  root.container.textContent = ''
  appendChild(root.container, tree, 'root')

  // Flush pending effects (post-render)
  for (const slot of root.slots.values()) {
    for (const effect of slot.effects) {
      if (effect.pending) {
        try {
          effect.pending()
        } catch (e) {
          console.error(e)
        }
        effect.pending = undefined
      }
    }
  }

  currentRoot = null
  root.rendering = false

  if (root.pendingRender) {
    root.pendingRender = false
    queueMicrotask(() => mount(root))
  }
}

// ── Public createRoot ────────────────────────────────────────────────
export function createRoot(container: HTMLElement) {
  return {
    render(tree: Child) {
      const root: RootState = {
        container,
        render: () => tree,
        slots: new Map(),
        currentSlotKey: '',
        currentSlot: null,
        stateIdx: 0,
        effectIdx: 0,
        refIdx: 0,
        rendering: false,
        pendingRender: false,
      }
      mount(root)
    },
  }
}

// ── Helper for bundle entry points ──────────────────────────────────
// The dev runner generates an entry that imports the user's page module,
// calls jsx() on its default export, and hands it to createRoot.
export { JSXNode }
