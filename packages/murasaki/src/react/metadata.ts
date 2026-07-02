/**
 * Static metadata shape, patterned after Next.js.
 *
 * Route modules export either:
 *
 * ```ts
 * export const metadata: Metadata = { title: 'Home' }
 * ```
 *
 * or a generator:
 *
 * ```ts
 * export async function generateMetadata(): Promise<Metadata> { … }
 * ```
 */
export interface Metadata {
  title?: string
  description?: string
  icons?: {
    icon?: string
    shortcut?: string
    apple?: string
  }
  openGraph?: {
    title?: string
    description?: string
    images?: string[]
  }
  [key: string]: unknown
}
