// Public JSX types for murasaki/jsx.

export type Props = Record<string, unknown>

export type Child = string | number | bigint | boolean | null | undefined | JSXNodeLike | Child[]

export interface JSXNodeLike {
  readonly __isJSXNode: true
  tag: string | Component
  props: Props
  children: Child[]
  toString(): string
}

export type Component<P = Props> = (props: P & { children?: Child }) => Child

/** React-compatible alias used by most user code. */
export type FC<P = Props> = Component<P>

/** For component refs / cloning. */
export type Element = JSXNodeLike

declare global {
  namespace JSX {
    type Element = JSXNodeLike
    interface ElementChildrenAttribute {
      children: object
    }
    // Loose intrinsic catalog — every HTML/SVG tag accepts any prop.
    // (Tightening this to a real catalog is a follow-up; keeps the
    //  runtime usable without bloating the type surface today.)
    interface IntrinsicElements {
      [tagName: string]: Record<string, unknown> & { children?: Child }
    }
  }
}
