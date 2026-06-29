// React Native–style layout primitives.
// All render to plain HTML elements under the hood, but give you a tighter,
// flexbox-first API that's easier to reason about for desktop layouts.
//
//   <View>          flex column
//   <Row>           flex row
//   <Stack>         alias for <View>
//   <Text>          text node wrapper
//
// You can keep using <div>, <span>, <p> etc. alongside these — they coexist.

import { jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'

type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'

const ALIGN_MAP: Record<Align, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
}
const JUSTIFY_MAP: Record<Justify, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
}

export type ViewProps = {
  children?: Child
  className?: string
  style?: Record<string, unknown>
  /** flex direction row (default: column) */
  row?: boolean
  /** add `flex: 1` to fill parent */
  grow?: boolean
  /** gap in px */
  gap?: number
  /** padding in px (or string for shorthand like '8px 16px') */
  padding?: number | string
  /** alignItems */
  align?: Align
  /** justifyContent */
  justify?: Justify
  /** wrap children */
  wrap?: boolean
  /** pass-through anchor props (id, onClick, etc.) */
  [key: string]: unknown
}

function buildStyle(props: ViewProps): Record<string, unknown> {
  const s: Record<string, unknown> = {
    display: 'flex',
    flexDirection: props.row ? 'row' : 'column',
  }
  if (props.grow) s.flex = '1'
  if (props.gap !== undefined) s.gap = `${props.gap}px`
  if (props.padding !== undefined) {
    s.padding = typeof props.padding === 'number' ? `${props.padding}px` : props.padding
  }
  if (props.align) s.alignItems = ALIGN_MAP[props.align]
  if (props.justify) s.justifyContent = JUSTIFY_MAP[props.justify]
  if (props.wrap) s.flexWrap = 'wrap'
  return { ...s, ...(props.style ?? {}) }
}

/** Flex container (column by default). */
export function View(props: ViewProps) {
  const { children, className, row, grow, gap, padding, align, justify, wrap, style, ...rest } =
    props
  void row
  void grow
  void gap
  void padding
  void align
  void justify
  void wrap
  void style
  return jsx('div', { className, style: buildStyle(props), ...rest, children })
}

/** Flex row. Shorthand for <View row>. */
export function Row(props: Omit<ViewProps, 'row'>) {
  return View({ ...props, row: true })
}

/** Alias of View. */
export const Stack = View

export type TextProps = {
  children?: Child
  className?: string
  style?: Record<string, unknown>
  /** font-size in px */
  size?: number
  /** font-weight */
  weight?: 'normal' | 'medium' | 'bold' | number
  /** color */
  color?: string
  /** text-align */
  align?: 'left' | 'center' | 'right'
  /** as= 'h1'..'h6' | 'p' | 'span' (default: span) */
  as?: string
  [key: string]: unknown
}

/** Inline text wrapper. */
export function Text(props: TextProps) {
  const { children, className, size, weight, color, align, as, style, ...rest } = props
  const w =
    typeof weight === 'number'
      ? weight
      : weight === 'medium'
        ? 500
        : weight === 'bold'
          ? 700
          : undefined
  const s: Record<string, unknown> = { ...(style ?? {}) }
  if (size !== undefined) s.fontSize = `${size}px`
  if (w !== undefined) s.fontWeight = w
  if (color) s.color = color
  if (align) s.textAlign = align
  return jsx(as || 'span', { className, style: s, ...rest, children })
}
