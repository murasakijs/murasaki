// <Link href="/about">About</Link>
//
// Emits a plain <a> tagged with data-murasaki-link. The dev runner injects
// a tiny script that intercepts clicks on these and switches the visible
// route block in place — no full reload, no flash.

import { jsx } from '../jsx/runtime.ts'
import type { Child } from '../jsx/types.ts'

export type LinkProps = {
  href: string
  children?: Child
  className?: string
  // Pass-through anchor props
  [key: string]: unknown
}

export function Link({ href, children, ...rest }: LinkProps) {
  return jsx('a', {
    href: `#${href}`,
    'data-murasaki-link': href,
    ...rest,
    children,
  })
}
