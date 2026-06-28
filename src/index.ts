// murasaki — public API
//
// Import like:
//   import type { Metadata } from 'murasaki'
//   import { Link }            from 'murasaki'

export type { LinkProps } from './components/Link.tsx'
export { Link } from './components/Link.tsx'

export type Metadata = {
  /** Default <title> for the app (overridden by <title> tag inside <head>) */
  title?: string
  /** <meta name="description"> */
  description?: string
  /** Initial window options (applied at first open; user can resize after) */
  window?: {
    /** Window title bar text (defaults to metadata.title) */
    title?: string
    /** Initial width in logical pixels */
    width?: number
    /** Initial height in logical pixels */
    height?: number
  }
}
