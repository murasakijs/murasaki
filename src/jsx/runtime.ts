// murasaki/jsx — SSR-only JSX runtime.
//
// Inspired by hono/jsx but trimmed for desktop-server use:
//   - no hooks (the view is rendered once per HMR cycle, no client state)
//   - no DOM renderer (we ship HTML to the OS WebView and that's it)
//   - no streaming / Suspense (single render → loadHtml())
//   - React-compatible enough to swap in for renderToStaticMarkup
//
// Two-step pipeline:
//   1. jsx(tag, props) → JSXNode  (tree)
//   2. JSXNode.toString() → HTML string
//
// User code that runs is the *user's* JSX (transformed to jsx() calls
// by tsx/esbuild with `jsxImportSource: "murasaki"`).

import type { Child, Component, JSXNodeLike, Props } from './types.ts'

// ── HTML escape ──────────────────────────────────────────────────────
const AMP = /&/g
const LT = /</g
const GT = />/g
const QT = /"/g

function escapeHtml(s: string): string {
  return s.replace(AMP, '&amp;').replace(LT, '&lt;').replace(GT, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(AMP, '&amp;').replace(QT, '&quot;')
}

// ── Void elements (no closing tag) ────────────────────────────────────
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

// ── Attribute name normalization (React → HTML) ───────────────────────
const ATTR_ALIAS: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  charSet: 'charset',
  crossOrigin: 'crossorigin',
  httpEquiv: 'http-equiv',
  itemProp: 'itemprop',
  fetchPriority: 'fetchpriority',
  noModule: 'nomodule',
  formAction: 'formaction',
  acceptCharset: 'accept-charset',
  autoComplete: 'autocomplete',
  autoFocus: 'autofocus',
  autoPlay: 'autoplay',
  contentEditable: 'contenteditable',
  defaultValue: 'value',
  defaultChecked: 'checked',
  encType: 'enctype',
  formMethod: 'formmethod',
  formNoValidate: 'formnovalidate',
  formTarget: 'formtarget',
  maxLength: 'maxlength',
  minLength: 'minlength',
  noValidate: 'novalidate',
  readOnly: 'readonly',
  rowSpan: 'rowspan',
  colSpan: 'colspan',
  spellCheck: 'spellcheck',
  tabIndex: 'tabindex',
  useMap: 'usemap',
  srcDoc: 'srcdoc',
  srcSet: 'srcset',
  hrefLang: 'hreflang',
  dateTime: 'datetime',
  enterKeyHint: 'enterkeyhint',
  inputMode: 'inputmode',
}

function normalizeAttrName(k: string): string {
  return ATTR_ALIAS[k] || k
}

// ── Style object → CSS string ─────────────────────────────────────────
function camelToKebab(k: string): string {
  // Leave already-kebab keys and CSS custom props (--foo) alone.
  if (k[0] === '-' || !/[A-Z]/.test(k)) return k
  return k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

// CSS properties that take unitless numbers (subset of React's list).
const UNITLESS = new Set([
  'animationIterationCount',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'boxFlex',
  'boxFlexGroup',
  'boxOrdinalGroup',
  'columnCount',
  'columns',
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'gridArea',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnStart',
  'gridRow',
  'gridRowEnd',
  'gridRowStart',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
])

function styleObjToString(obj: Record<string, unknown>): string {
  let out = ''
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === false) continue
    let value: string
    if (typeof v === 'number') {
      value = UNITLESS.has(k) ? String(v) : `${v}px`
    } else if (typeof v === 'string') {
      value = v
    } else {
      continue
    }
    out += `${out ? ';' : ''}${camelToKebab(k)}:${value}`
  }
  return out
}

// ── Attribute rendering ──────────────────────────────────────────────
function renderAttrs(props: Props): string {
  let out = ''
  for (const k in props) {
    if (k === 'children' || k === 'key' || k === 'ref' || k === '__source' || k === '__self')
      continue
    const v = props[k]
    if (v == null || v === false) continue

    const name = normalizeAttrName(k)

    // Boolean attribute
    if (v === true) {
      out += ` ${name}`
      continue
    }

    // Inline style object
    if (k === 'style' && typeof v === 'object') {
      const css = styleObjToString(v as Record<string, unknown>)
      if (css) out += ` style="${escapeAttr(css)}"`
      continue
    }

    // dangerouslySetInnerHTML is handled in JSXNode.toString(), skip here
    if (k === 'dangerouslySetInnerHTML') continue

    out += ` ${name}="${escapeAttr(String(v))}"`
  }
  return out
}

// ── Children rendering ───────────────────────────────────────────────
function renderChild(c: Child): string {
  if (c == null || c === false || c === true) return ''
  if (typeof c === 'string') return escapeHtml(c)
  if (typeof c === 'number' || typeof c === 'bigint') return String(c)
  if (Array.isArray(c)) {
    let s = ''
    for (const item of c) s += renderChild(item)
    return s
  }
  if (isJSXNode(c)) return c.toString()
  return ''
}

// ── JSXNode ──────────────────────────────────────────────────────────
export class JSXNode implements JSXNodeLike {
  readonly __isJSXNode = true as const
  tag: string | Component
  props: Props
  children: Child[]

  constructor(tag: string | Component, props: Props, children: Child[]) {
    this.tag = tag
    this.props = props
    this.children = children
  }

  toString(): string {
    const { tag, props, children } = this

    // Fragment / functional component
    if (typeof tag === 'function') {
      // Always pass children via props (React-compat)
      const merged = { ...props, children: children.length === 1 ? children[0] : children }
      const result = tag(merged)
      return renderChild(result as Child)
    }

    // Intrinsic element
    const attrs = renderAttrs(props)

    // dangerouslySetInnerHTML overrides children
    const dsi = props.dangerouslySetInnerHTML as { __html?: string } | undefined
    if (dsi && typeof dsi.__html === 'string') {
      return `<${tag}${attrs}>${dsi.__html}</${tag}>`
    }

    if (VOID_ELEMENTS.has(tag)) {
      // Self-closing for void elements
      return `<${tag}${attrs}/>`
    }

    let childHtml = ''
    for (const c of children) childHtml += renderChild(c)

    return `<${tag}${attrs}>${childHtml}</${tag}>`
  }
}

export function isJSXNode(v: unknown): v is JSXNode {
  return typeof v === 'object' && v !== null && (v as JSXNodeLike).__isJSXNode === true
}

// ── Public factory (React-compat: createElement / jsx) ────────────────
export function jsx(
  tag: string | Component,
  props: Props | null,
  ..._restChildren: unknown[]
): JSXNode {
  const p = props ?? {}
  const rawChildren = (p as { children?: Child }).children
  const children: Child[] = Array.isArray(rawChildren)
    ? rawChildren
    : rawChildren != null
      ? [rawChildren]
      : []
  // Strip children from props (it's stored separately)
  const { children: _drop, ...rest } = p as Props & { children?: Child }
  return new JSXNode(tag, rest, children)
}

/** React-compatible alias. */
export const createElement = jsx

/** Fragment — renders children without a wrapper tag. */
export function Fragment(props: { children?: Child }): Child {
  return props.children ?? null
}

/** Check if something is a JSX element (React.isValidElement compat). */
export function isValidElement(v: unknown): v is JSXNode {
  return isJSXNode(v)
}

/** Convert any value (JSXNode, string, array, etc.) to an HTML string. */
export function renderToString(value: Child): string {
  return renderChild(value)
}
